import { createDisposable } from '@posthog/browser-common'
import type {
    ApiResponse,
    CaptureOptions as BrowserCommonCaptureOptions,
    CapturedEventInfo,
    Client,
    DeepReadonly,
    Disposable,
    Extension,
    KeyValueStore,
    Listener,
    SendRequestInit,
    SessionContext,
} from '@posthog/browser-common'
import { ExtensionRuntime } from '@posthog/browser-common/extension-runtime'
import { logger } from '@posthog/browser-common/utils/logger'
import { isUndefined, type Logger } from '@posthog/core'

import Config from '../config'
import { DEVICE_ID } from '../constants'
import { extendURLParams } from '../request'
import type { PostHog } from '../posthog-core'
import type { CaptureOptions, EventName, Properties, QueuedRequestWithOptions, RemoteConfigResult } from '../types'

class BrowserClientKeyValueStore implements KeyValueStore {
    constructor(private readonly _instance: PostHog) {}

    get<T = unknown>(key: string): T | undefined
    get<T extends object>(keys: readonly (keyof T & string)[]): Partial<T>
    get(keyOrKeys: string | readonly string[]): unknown {
        const persistence = this._instance.persistence
        if (typeof keyOrKeys === 'string') {
            return persistence?.get_property(keyOrKeys)
        }
        const values: Record<string, unknown> = {}
        for (const key of keyOrKeys) {
            const value = persistence?.get_property(key)
            if (!isUndefined(value)) {
                values[key] = value
            }
        }
        return values
    }

    set(key: string, value: unknown): void
    set(values: Record<string, unknown>): void
    set(properties: string | Record<string, unknown>, value?: unknown): void {
        this._instance.persistence?.register(
            (typeof properties === 'string' ? { [properties]: value } : properties) as Properties
        )
    }

    remove(keyOrKeys: string | readonly string[]): void {
        this._instance.persistence?.unregister(keyOrKeys)
    }
}

const REMOTE_CONFIG_EVENT = 'extensionsRemoteConfig'

/** One shared extension client and lifecycle host per browser-v1 PostHog instance. */
export class BrowserClientAdapter implements Client, Disposable {
    readonly kv: KeyValueStore
    readonly onEvent: Listener<CapturedEventInfo>
    readonly onRemoteConfig: Listener<DeepReadonly<RemoteConfigResult>>

    private readonly _logger: Logger
    private readonly _runtime: ExtensionRuntime
    private _latestRemoteConfigResult: RemoteConfigResult | undefined
    private _disposed = false

    constructor(readonly instance: PostHog) {
        this._logger = logger.createLogger('[BrowserExtensions]')
        this._latestRemoteConfigResult = instance._lastRemoteConfig
        this.kv = new BrowserClientKeyValueStore(instance)
        this.onEvent = (handler) => {
            const unsubscribe = this.instance.on('eventCaptured', (event) => {
                try {
                    handler({
                        event: event.event,
                        properties: event.properties,
                    })
                } catch (error) {
                    this._logger.error('Browser extension event listener failed', error)
                }
            })
            return createDisposable(unsubscribe)
        }
        this.onRemoteConfig = (handler) => {
            if (this._disposed) {
                return createDisposable(() => {})
            }

            const invoke = (result: RemoteConfigResult): void => {
                try {
                    handler(result)
                } catch (error) {
                    this._logger.error('Browser extension remote config listener failed', error)
                }
            }
            const unsubscribe = this.instance._internalEventEmitter.on(REMOTE_CONFIG_EVENT, invoke)
            if (this._latestRemoteConfigResult) {
                invoke(this._latestRemoteConfigResult)
            }
            return createDisposable(unsubscribe)
        }
        this._runtime = new ExtensionRuntime(this._logger, this)
    }

    get logger(): Logger {
        return this._logger
    }

    get distinctId(): string {
        return this.instance.get_distinct_id()
    }

    get anonymousId(): string {
        return (this.instance.get_property(DEVICE_ID) as string | undefined) ?? this.distinctId
    }

    get deviceId(): string | undefined {
        const value = this.instance.get_property(DEVICE_ID)
        return typeof value === 'string' ? value : undefined
    }

    get library(): { name: string; version: string } {
        return { name: Config.LIB_NAME, version: Config.LIB_VERSION }
    }

    get initialPersonProperties(): Record<string, unknown> {
        return (this.instance.persistence?.get_initial_props() ?? {}) as Record<string, unknown>
    }

    get groups(): Record<string, string> {
        return this.instance.getGroups() as Record<string, string>
    }

    get session(): SessionContext {
        try {
            const current = this.instance.sessionManager?.checkAndGetSessionAndWindowId(true)
            return {
                sessionId: current?.sessionId ?? '',
                windowId: current?.windowId ?? '',
                sessionStartTimestamp: current?.sessionStartTimestamp ?? 0,
            }
        } catch {
            return { sessionId: '', windowId: '', sessionStartTimestamp: 0 }
        }
    }

    get projectToken(): string {
        return this.instance.config.token
    }

    add(extension: Extension): Promise<void> {
        return this._runtime.add(extension)
    }

    async capture(event: string, properties?: Properties | null, options?: BrowserCommonCaptureOptions): Promise<void> {
        if (!options) {
            this.instance.capture(event as EventName, properties)
            return
        }

        const captureOptions: CaptureOptions = {
            timestamp: options.timestamp,
            uuid: options.uuid,
            $set: options.set as Properties | undefined,
            $set_once: options.setOnce as Properties | undefined,
        }
        this.instance.capture(event as EventName, properties, captureOptions)
    }

    registerDynamicEventProperties(producer: () => Record<string, unknown>): Disposable {
        return createDisposable(this.instance._registerExtensionEventProperties(producer))
    }

    handleRemoteConfig(result: RemoteConfigResult): void {
        if (this._disposed) {
            return
        }

        this._latestRemoteConfigResult = result
        this.instance._internalEventEmitter.emit(REMOTE_CONFIG_EVENT, result)
    }

    async sendRequest(path: string, init: SendRequestInit = {}): Promise<ApiResponse> {
        const endpoint = this.instance.requestRouter.endpointFor(init.target ?? 'api', path)
        const requestOptions: QueuedRequestWithOptions = {
            method: init.method,
            url: init.query ? extendURLParams(endpoint, init.query) : endpoint,
            data: init.body as QueuedRequestWithOptions['data'],
            headers: init.headers,
            timeout: init.timeoutMs,
            fireCallbackOnDrop: true,
            transport: init.transport,
            compression: init.compression,
            timestampMode: init.sentAt,
        }

        if (init.transport === 'sendBeacon') {
            this.instance._send_request(requestOptions)
            return { statusCode: 202 }
        }

        // eslint-disable-next-line compat/compat -- The shared Client transport is intentionally awaitable.
        return new Promise((resolve) => {
            requestOptions.callback = resolve
            this.instance._send_request(requestOptions)
        })
    }

    dispose(): void {
        if (this._disposed) {
            return
        }
        this._disposed = true
        this._runtime.dispose()
    }
}
