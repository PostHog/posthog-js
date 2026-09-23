import { createDisposable } from '@posthog/browser-common'
import type {
    ApiResponse,
    CaptureOptions as BrowserCommonCaptureOptions,
    CapturedEventInfo,
    Client,
    DeepReadonly,
    Disposable,
    Extension,
    ExtensionToken,
    KeyValueStore,
    Listener,
    SendRequestInit,
    SessionContext,
} from '@posthog/browser-common'
import { FeatureFlagsCommonExtension } from '@posthog/browser-common/extension-tokens'
import { logger } from '@posthog/browser-common/utils/logger'
import { Compression, isFunction, isUndefined, type Logger } from '@posthog/core'

import Config from '../config'
import { DEVICE_ID } from '../constants'
import { AutocaptureExtension, FeatureFlagsExtension, LogsExtension, SurveysExtension } from '../extension-tokens'
import { extendURLParams } from '../request'
import type { PostHog } from '../posthog-core'
import type { CaptureOptions, EventName, Properties, QueuedRequestWithOptions, RemoteConfigResult } from '../types'

class BrowserClientKeyValueStore implements KeyValueStore {
    constructor(private readonly _instance: PostHog) {}

    initialize(): void {}

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

/** A capability view of a PostHog instance. The instance owns extension lifecycle. */
export class BrowserClientAdapter implements Client {
    readonly kv: KeyValueStore
    readonly onSession: Listener<string>
    readonly onEvent: Listener<CapturedEventInfo>
    readonly onRemoteConfig: Listener<DeepReadonly<RemoteConfigResult>>

    private readonly _logger: Logger

    constructor(readonly instance: PostHog) {
        this._logger = logger
        this.kv = new BrowserClientKeyValueStore(instance)
        this.onSession = (handler) => {
            return createDisposable(
                this.instance.onSessionId((sessionId) => {
                    try {
                        handler(sessionId)
                    } catch (error) {
                        this._logger.error('Browser extension session listener failed', error)
                    }
                })
            )
        }
        this.onEvent = (handler) => {
            const unsubscribe = this.instance._addCaptureHook((event, payload) => {
                if (!payload) return
                try {
                    handler({
                        event,
                        properties: payload.properties,
                    })
                } catch (error) {
                    this._logger.error('Browser extension event listener failed', error)
                }
            })
            return createDisposable(unsubscribe)
        }
        this.onRemoteConfig = (handler) => {
            const invoke = (result: RemoteConfigResult): void => {
                try {
                    handler(result)
                } catch (error) {
                    this._logger.error('Browser extension remote config listener failed', error)
                }
            }
            const unsubscribe = this.instance._internalEventEmitter.on(REMOTE_CONFIG_EVENT, invoke)
            if (this.instance._lastRemoteConfig) {
                invoke(this.instance._lastRemoteConfig)
            }
            return createDisposable(unsubscribe)
        }
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
                lastActivityTimestamp: current?.lastActivityTimestamp ?? 0,
            }
        } catch {
            return { sessionId: '', windowId: '', sessionStartTimestamp: 0, lastActivityTimestamp: 0 }
        }
    }

    get isOptedOut(): boolean {
        return this.instance.has_opted_out_capturing()
    }

    get canCapture(): boolean {
        // Older cores have no is_capturing() or cookieless mode.
        return isFunction(this.instance.is_capturing) ? this.instance.is_capturing() : !this.isOptedOut
    }

    get projectToken(): string {
        return this.instance.config.token
    }

    getExtension<T extends Extension>(token: ExtensionToken<T>): T | undefined
    getExtension<T extends Extension = Extension>(name: string): T | undefined
    getExtension<T extends Extension = Extension>(name: string): T | undefined {
        let extension: Extension | undefined
        switch (name) {
            case FeatureFlagsExtension:
            case FeatureFlagsCommonExtension:
                extension = this.instance.featureFlags
                break
            case LogsExtension:
                extension = this.instance.logs
                break
            case SurveysExtension:
                extension = this.instance.surveys
                break
            case AutocaptureExtension:
                extension = this.instance.autocapture
                break
        }
        return extension as T | undefined
    }

    capture(event: string, properties?: Properties | null, options?: BrowserCommonCaptureOptions): void {
        if (!options) {
            this.instance.capture(event as EventName, properties)
            return
        }

        const captureOptions: CaptureOptions = {
            timestamp: options.timestamp,
            uuid: options.uuid,
            $set: options.set as Properties | undefined,
            $set_once: options.setOnce as Properties | undefined,
            ...(options.delivery === 'unload' ? { transport: 'sendBeacon' as const, send_instantly: true } : {}),
        }
        this.instance.capture(event as EventName, properties, captureOptions)
    }

    registerDynamicEventProperties(producer: () => Record<string, unknown>): Disposable {
        return createDisposable(this.instance._registerExtensionEventProperties(producer))
    }

    async sendRequest(path: string, init: SendRequestInit = {}): Promise<ApiResponse> {
        const target = init.target ?? 'api'
        const endpoint = this.instance.requestRouter.endpointFor(target, path)
        const isLogsRequest = target === 'api' && path === '/i/v1/logs'
        const requestOptions: QueuedRequestWithOptions = {
            method: init.method,
            url: init.query ? extendURLParams(endpoint, init.query) : endpoint,
            data: init.body as QueuedRequestWithOptions['data'],
            headers: init.headers,
            timeout: init.timeoutMs,
            fireCallbackOnDrop: true,
            transport: init.transport,
            compression: init.compression,
            compressionFallback:
                init.target === 'flags' && init.compression === 'best-available' ? Compression.Base64 : undefined,
            timestampMode: init.sentAt,
        }

        if (isLogsRequest) {
            requestOptions.batchKey = 'logs'
        }

        if (init.transport === 'sendBeacon') {
            this.instance._send_request(requestOptions)
            return { statusCode: 202 }
        }

        // oxlint-disable-next-line compat/compat -- The shared Client transport is intentionally awaitable.
        return new Promise((resolve) => {
            requestOptions.callback = resolve
            this.instance._send_request(requestOptions)
        })
    }
}
