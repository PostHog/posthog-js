import { CoreExtension as CoreExtensionToken, createDisposable } from '@posthog/browser-common'
import type {
    ApiResponse,
    CaptureOptions as BrowserCommonCaptureOptions,
    CapturedEventInfo,
    Client,
    CoreExtension,
    DeepReadonly,
    Disposable,
    Extension,
    ExtensionToken,
    KeyValueStore,
    Listener,
    NewSessionInfo,
    NewSessionReason,
    RemoteConfig,
    SendRequestInit,
    SessionContext,
} from '@posthog/browser-common'
import { ExtensionRuntime } from '@posthog/browser-common/extension-runtime'
import { logger } from '@posthog/browser-common/utils/logger'
import type { Logger } from '@posthog/core'

import { DEVICE_ID } from '../constants'
import { extendURLParams } from '../request'
import type { PostHog } from '../posthog-core'
import type {
    CaptureOptions,
    EventName,
    Properties,
    Property,
    QueuedRequestWithOptions,
    RemoteConfigResult,
} from '../types'

class BrowserExtensionKeyValueStore implements KeyValueStore {
    constructor(private readonly _instance: PostHog) {}

    get<T = unknown>(key: string): T | undefined {
        return this._instance.persistence?.props[key] as T | undefined
    }

    set(key: string, value: unknown): void {
        this._instance.persistence?.register({ [key]: value as Property })
    }

    remove(key: string): void {
        this._instance.persistence?.unregister(key)
    }
}

const REMOTE_CONFIG_EVENT = 'extensionsRemoteConfig'
const NEW_SESSION_EVENT = 'extensionsNewSession'

/**
 * One browser-v1 host per PostHog instance. It composes the shared extension
 * runtime with browser-v1 event streams and a Client adapter for each extension.
 */
export class BrowserExtensionHost implements Disposable {
    private readonly _remoteConfigWaiters: Array<(config: RemoteConfig | undefined) => void> = []
    private readonly _logger: Logger
    private readonly _runtime: ExtensionRuntime
    private _latestRemoteConfigResult: RemoteConfigResult | undefined
    private _sessionSource: PostHog['sessionManager']
    private _removeSessionListener: (() => void) | undefined
    private _removeForcedIdleResetListener: (() => void) | undefined
    private _pendingSessionReason: NewSessionReason | undefined
    private _pendingForcedIdleReset = false
    private _disposePromise: Promise<void> | undefined
    private _disposed = false

    constructor(readonly instance: PostHog) {
        this._logger = logger.createLogger('[BrowserExtensions]')
        this._runtime = new ExtensionRuntime(this._logger)
        this._latestRemoteConfigResult = instance._lastRemoteConfig
        this.rebindSessionSource()
        void this.add(new BrowserCoreExtension(this))
    }

    get logger(): Logger {
        return this._logger
    }

    get onRemoteConfig(): Listener<RemoteConfig> {
        return (handler) =>
            createDisposable(
                this.instance._internalEventEmitter.on(REMOTE_CONFIG_EVENT, (config) => {
                    this._invokeListener('remote config', handler, config)
                })
            )
    }

    get onNewSession(): Listener<NewSessionInfo> {
        return (handler) =>
            createDisposable(
                this.instance._internalEventEmitter.on(NEW_SESSION_EVENT, (session) => {
                    this._invokeListener('new session', handler, session)
                })
            )
    }

    add(extension: Extension): Promise<void> {
        return this._runtime.add(extension, new BrowserClientAdapter(this, extension.name))
    }

    getExtension<T>(token: ExtensionToken<T>): T | undefined {
        return this._runtime.getExtension(token)
    }

    handleRemoteConfig(result: RemoteConfigResult): void {
        if (this._disposed) {
            return
        }

        this._latestRemoteConfigResult = result
        const config = result.ok ? (result.config as unknown as RemoteConfig) : undefined
        this._remoteConfigWaiters.splice(0).forEach((resolve) => resolve(config))
        if (config) {
            this.instance._internalEventEmitter.emit(REMOTE_CONFIG_EVENT, config)
        }
    }

    async getRemoteConfig(): Promise<RemoteConfig | undefined> {
        if (this._latestRemoteConfigResult) {
            return this._latestRemoteConfigResult.ok ? this._latestRemoteConfigResult.config : undefined
        }
        if (this.instance._shouldDisableFlags()) {
            return undefined
        }
        // eslint-disable-next-line compat/compat -- The shared Client contract requires an awaitable first result.
        return new Promise((resolve) => this._remoteConfigWaiters.push(resolve))
    }

    dispose(): Promise<void> {
        if (!this._disposePromise) {
            this._disposed = true
            this._disposePromise = this._disposeAll()
        }
        return this._disposePromise
    }

    markReset(): void {
        this._pendingSessionReason = 'reset'
    }

    rebindSessionSource(): void {
        if (this._disposed || this._sessionSource === this.instance.sessionManager) {
            return
        }
        this._removeSessionListener?.()
        this._removeForcedIdleResetListener?.()
        this._removeSessionListener = undefined
        this._removeForcedIdleResetListener = undefined
        this._pendingForcedIdleReset = false

        const sessionSource = this.instance.sessionManager
        this._sessionSource = sessionSource
        this._removeForcedIdleResetListener = sessionSource?.on?.('forcedIdleReset', () => {
            if (!this._disposed && this._sessionSource === sessionSource) {
                this._pendingForcedIdleReset = true
            }
        })
        this._removeSessionListener = this.instance.onSessionId((sessionId, windowId, changeReason) => {
            const isSessionRotation =
                !!changeReason?.noSessionId ||
                !!changeReason?.activityTimeout ||
                !!changeReason?.sessionPastMaximumLength ||
                !!changeReason?.crossTabAdoption
            if (!isSessionRotation) {
                return
            }

            const pendingSessionReason = this._pendingSessionReason
            const pendingForcedIdleReset = this._pendingForcedIdleReset
            this._pendingSessionReason = undefined
            this._pendingForcedIdleReset = false

            let reason: NewSessionReason
            if (pendingSessionReason) {
                reason = pendingSessionReason
            } else if (pendingForcedIdleReset) {
                reason = 'idleTimeout'
            } else if (changeReason?.crossTabAdoption) {
                reason = 'crossTabAdoption'
            } else if (changeReason?.activityTimeout) {
                reason = 'idleTimeout'
            } else if (changeReason?.sessionPastMaximumLength) {
                reason = 'maxLength'
            } else {
                reason = 'initial'
            }

            const current = this._sessionContext(sessionId, windowId ?? '')
            this.instance._internalEventEmitter.emit(NEW_SESSION_EVENT, { ...current, reason })
        })
    }

    private async _disposeAll(): Promise<void> {
        this._remoteConfigWaiters.splice(0).forEach((resolve) => resolve(undefined))
        await this._runtime.dispose()
        this._removeSessionListener?.()
        this._removeForcedIdleResetListener?.()
        this._removeSessionListener = undefined
        this._removeForcedIdleResetListener = undefined
        this._sessionSource = undefined
        this._pendingSessionReason = undefined
        this._pendingForcedIdleReset = false
    }

    private _invokeListener<T>(stream: string, handler: (value: T) => void, value: T): void {
        try {
            handler(value)
        } catch (error) {
            this._logger.error(`Browser extension ${stream} listener failed`, error)
        }
    }

    sessionContext(): SessionContext {
        return this._sessionContext()
    }

    private _sessionContext(sessionId?: string, windowId?: string): SessionContext {
        try {
            const current = this.instance.sessionManager?.checkAndGetSessionAndWindowId(true)
            return {
                sessionId: sessionId ?? current?.sessionId ?? '',
                windowId: windowId ?? current?.windowId ?? '',
                sessionStartTimestamp: current?.sessionStartTimestamp ?? 0,
            }
        } catch {
            return {
                sessionId: sessionId ?? '',
                windowId: windowId ?? '',
                sessionStartTimestamp: 0,
            }
        }
    }
}

/** The browser-v1 implementation of the shared core analytics extension. */
class BrowserCoreExtension implements CoreExtension {
    readonly name = 'core'
    readonly provides = [CoreExtensionToken]
    readonly onEvent: Listener<CapturedEventInfo>
    readonly onNewSession: Listener<NewSessionInfo>
    readonly onRemoteConfig: Listener<DeepReadonly<RemoteConfig>>

    constructor(private readonly _host: BrowserExtensionHost) {
        this.onEvent = (handler) => {
            const unsubscribe = this._host.instance.on('eventCaptured', (event) => {
                try {
                    handler({
                        event: event.event,
                        properties: event.properties,
                    })
                } catch (error) {
                    this._host.logger.error('Browser extension event listener failed', error)
                }
            })
            return createDisposable(unsubscribe)
        }
        this.onNewSession = _host.onNewSession
        this.onRemoteConfig = _host.onRemoteConfig
    }

    get distinctId(): string {
        return this._host.instance.get_distinct_id()
    }

    get anonymousId(): string {
        return (this._host.instance.get_property(DEVICE_ID) as string | undefined) ?? this.distinctId
    }

    get groups(): Record<string, string> {
        return this._host.instance.getGroups() as Record<string, string>
    }

    get session(): SessionContext {
        return this._host.sessionContext()
    }

    setup(): void {}

    async capture(event: string, properties?: Properties | null, options?: BrowserCommonCaptureOptions): Promise<void> {
        if (!options) {
            this._host.instance.capture(event as EventName, properties)
            return
        }

        const captureOptions: CaptureOptions = {
            timestamp: options.timestamp,
            uuid: options.uuid,
            $set: options.set as Properties | undefined,
            $set_once: options.setOnce as Properties | undefined,
        }
        this._host.instance.capture(event as EventName, properties, captureOptions)
    }

    registerDynamicEventProperties(producer: () => Record<string, unknown>): Disposable {
        return createDisposable(this._host.instance._registerExtensionEventProperties(producer))
    }

    getRemoteConfig(): Promise<DeepReadonly<RemoteConfig> | undefined> {
        return this._host.getRemoteConfig()
    }

    dispose(): void {}
}

/** A host-services facade scoped to one shared extension. */
export class BrowserClientAdapter implements Client {
    readonly kv: KeyValueStore
    readonly logger: Logger

    constructor(
        private readonly _host: BrowserExtensionHost,
        extensionName: string
    ) {
        this.kv = new BrowserExtensionKeyValueStore(_host.instance)
        this.logger = _host.logger.createLogger(`[${extensionName}]`)
    }

    get projectToken(): string {
        return this._host.instance.config.token
    }

    async sendRequest(path: string, init: SendRequestInit = {}): Promise<ApiResponse> {
        const endpoint = this._host.instance.requestRouter.endpointFor(init.target ?? 'api', path)
        const requestOptions: QueuedRequestWithOptions = {
            method: init.method,
            url: init.query ? extendURLParams(endpoint, init.query) : endpoint,
            data: init.body as QueuedRequestWithOptions['data'],
            headers: init.headers,
            timeout: init.timeoutMs,
            fireCallbackOnDrop: true,
            transport: init.transport,
        }

        if (init.transport === 'sendBeacon') {
            this._host.instance._send_request(requestOptions)
            return { statusCode: 202 }
        }

        // eslint-disable-next-line compat/compat -- The shared Client transport is intentionally awaitable.
        return new Promise((resolve) => {
            requestOptions.callback = resolve
            this._host.instance._send_request(requestOptions)
        })
    }

    getExtension<T>(token: ExtensionToken<T>): T | undefined {
        return this._host.getExtension(token)
    }
}
