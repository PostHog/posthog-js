import { LOAD_EXT_NOT_FOUND } from './constants'
import Config from './config'
import { PostHog } from './posthog-core'
import type { CaptureLogOptions, RemoteConfig, Logger, LogSdkContext, OtlpLogsPayload } from './types'
import {
    PostHogLogs as CorePostHogLogs,
    buildOtlpLogsPayload,
    buildResourceAttributes,
    isNullish,
    PostHogPersistedProperty,
} from '@posthog/core'
import type { BufferedLogEntry, ResolvedPostHogLogsConfig, SendLogsBatchOutcome } from '@posthog/core'
import { assignableWindow, window } from './utils/globals'
import { addEventListener } from './utils'
import { createLogger } from './utils/logger'
import { Extension } from './extensions/types'
import { resolveLogsConfig } from './logs-defaults'

const LOGS_ENDPOINT = '/i/v1/logs'
// Safety backstop for a `_send_request` that never calls back. Set above the
// request layer's own 60s timeout so a real (slow-but-completing) request always
// settles via its callback first; this only fires on a genuinely callback-less
// send (e.g. request enqueued before load, or a transport that never reports).
const LOGS_SEND_TIMEOUT_MS = 90000

export class PostHogLogs implements Extension {
    private _isLogsEnabled: boolean = false
    private _isLoaded: boolean = false
    private readonly _logger = createLogger('[logs]')

    // In-memory only; records do not survive a page reload.
    private _queue: BufferedLogEntry[] = []
    private _core: CorePostHogLogs | undefined
    private _resolvedConfig: ResolvedPostHogLogsConfig | undefined
    // The `logs` config the current `_core` was built from; a change rebuilds it.
    private _resolvedFrom: PostHog['config']['logs']
    private _capture_logger: Logger | undefined

    constructor(private readonly _instance: PostHog) {
        if (this._instance && this._instance.config.logs?.captureConsoleLogs) {
            this._isLogsEnabled = true
        }
        // Flush promptly when the tab regains connectivity instead of waiting out
        // the retry backoff. One listener for the wrapper's lifetime, routed to the
        // current core (which may be rebuilt on a config change).
        if (window) {
            addEventListener(window, 'online', this._onReconnect)
        }
    }

    private _onReconnect = (): void => {
        this._core?.onReconnect()
    }

    // The extension is constructed before `init` applies config, so build the core
    // lazily and rebuild when `config.logs` is swapped (e.g. via `set_config`).
    // Reset the old core first so its armed timer can't double-flush the shared,
    // wrapper-owned queue against the new core.
    private _getCore(): CorePostHogLogs {
        const logsConfig = this._instance?.config?.logs
        if (!this._core || this._resolvedFrom !== logsConfig) {
            this._core?.reset()
            this._resolvedFrom = logsConfig
            this._resolvedConfig = resolveLogsConfig(logsConfig)
            this._core = new CorePostHogLogs(
                this._createHost(),
                this._resolvedConfig,
                this._logger,
                () => this._getSdkContext(),
                (fn) => fn()
            )
        }
        return this._core
    }

    // `_getCore` assigns `_resolvedConfig` alongside `_core`, so it's set on return.
    private _getResolvedConfig(): ResolvedPostHogLogsConfig {
        this._getCore()
        return this._resolvedConfig as ResolvedPostHogLogsConfig
    }

    initialize() {
        this.loadIfEnabled()
    }

    onRemoteConfig(response: RemoteConfig) {
        const logCapture = response.logs?.captureConsoleLogs
        if (isNullish(logCapture) || !logCapture) {
            return
        }
        this._isLogsEnabled = true
        this.loadIfEnabled()
    }

    reset(): void {
        this._queue = []
        this._core?.reset()
    }

    captureLog(options: CaptureLogOptions): void {
        this._getCore().captureLog(options)
    }

    get logger(): Logger {
        if (!this._capture_logger) {
            this._capture_logger = {
                trace: (body, attributes) => this.captureLog({ body, level: 'trace', attributes }),
                debug: (body, attributes) => this.captureLog({ body, level: 'debug', attributes }),
                info: (body, attributes) => this.captureLog({ body, level: 'info', attributes }),
                warn: (body, attributes) => this.captureLog({ body, level: 'warn', attributes }),
                error: (body, attributes) => this.captureLog({ body, level: 'error', attributes }),
                fatal: (body, attributes) => this.captureLog({ body, level: 'fatal', attributes }),
            }
        }
        return this._capture_logger
    }

    // An explicit transport drains the whole queue in one request over that transport
    // (core's batched flush can't force a transport, and the unload sendBeacon must be
    // synchronous). No transport → core's batched, 413-aware, retrying flush.
    flushLogs(transport?: 'XHR' | 'fetch' | 'sendBeacon'): void {
        if (transport) {
            this._flushViaTransport(transport)
            return
        }
        void this._getCore()
            .flush()
            .catch((err) => this._logger.error('PostHog logs flush failed:', err))
    }

    loadIfEnabled() {
        if (!this._isLogsEnabled || this._isLoaded) {
            return
        }

        const phExtensions = assignableWindow?.__PosthogExtensions__
        if (!phExtensions) {
            this._logger.error('PostHog Extensions not found.')
            return
        }

        const loadExternalDependency = phExtensions.loadExternalDependency
        if (!loadExternalDependency) {
            this._logger.error(LOAD_EXT_NOT_FOUND)
            return
        }

        loadExternalDependency(this._instance, 'logs', (err) => {
            if (err || !phExtensions.logs?.initializeLogs) {
                this._logger.error('Could not load logs script', err)
            } else {
                phExtensions.logs.initializeLogs(this._instance)
                this._isLoaded = true
            }
        })
    }

    // Host adapter for core's `PostHogLogs`; structurally checked against `LogsHost`
    // at the `new CorePostHogLogs` call, so no explicit annotation is needed.
    private _createHost() {
        const ph = this._instance
        return {
            // The browser gates capture through `is_capturing()` (see `optedOut`).
            get isDisabled() {
                return false
            },
            get optedOut() {
                return !ph.is_capturing()
            },
            // Live queue by reference; core mutates it in place and persists via the setter.
            getPersistedProperty: <T>(key: PostHogPersistedProperty): T | undefined =>
                key === PostHogPersistedProperty.LogsQueue ? (this._queue as unknown as T) : undefined,
            setPersistedProperty: <T>(key: PostHogPersistedProperty, value: T | null): void => {
                if (key === PostHogPersistedProperty.LogsQueue) {
                    this._queue = (value as unknown as BufferedLogEntry[]) ?? []
                }
            },
            _sendLogsBatch: (payload: OtlpLogsPayload) => this._sendLogsBatch(payload),
            getLibraryId: () => Config.LIB_NAME,
            getLibraryVersion: () => Config.LIB_VERSION,
        }
    }

    private _sendLogsBatch(payload: OtlpLogsPayload): Promise<SendLogsBatchOutcome> {
        // eslint-disable-next-line compat/compat
        return new Promise((resolve) => {
            let settled = false
            const settle = (outcome: SendLogsBatchOutcome) => {
                if (settled) {
                    return
                }
                settled = true
                clearTimeout(timer)
                resolve(outcome)
            }

            // Backstop for `_send_request` paths that never call back, so the promise
            // always settles and core's flush can't wedge. Keeps records for retry.
            const timer = setTimeout(
                () => settle({ kind: 'retry-later', error: new Error('logs request timed out') }),
                LOGS_SEND_TIMEOUT_MS
            )

            this._instance._send_request({
                method: 'POST',
                url: this._logsUrl(),
                data: payload,
                compression: 'best-available',
                batchKey: 'logs',
                // Notify on the drop paths (not loaded, rate limited) so they retry, not stall.
                fireCallbackOnDrop: true,
                callback: (response) => {
                    const status = response.statusCode
                    if (status >= 200 && status < 300) {
                        settle({ kind: 'ok' })
                    } else if (status === 413) {
                        settle({ kind: 'too-large' })
                    } else if (status === 0 || status === 429 || status >= 500) {
                        // Transient (network / rate-limit / server error): keep and retry.
                        settle({
                            kind: 'retry-later',
                            error: response.error ?? new Error(`logs request failed with status ${status}`),
                        })
                    } else {
                        // Client error (4xx): won't succeed on retry, drop.
                        settle({ kind: 'fatal', error: new Error(`logs request failed with status ${status}`) })
                    }
                },
            })
        })
    }

    private _flushViaTransport(transport: 'XHR' | 'fetch' | 'sendBeacon'): void {
        const config = this._getResolvedConfig()
        if (this._queue.length === 0) {
            return
        }
        const records = this._queue.map((e) => e.record)
        this._queue = []
        // Shared with the core flush path so resource attributes can't drift.
        const payload = buildOtlpLogsPayload(
            records,
            buildResourceAttributes(config, Config.LIB_NAME, Config.LIB_VERSION),
            Config.LIB_NAME,
            Config.LIB_VERSION
        )
        this._instance._send_request({
            method: 'POST',
            url: this._logsUrl(),
            data: payload,
            compression: 'best-available',
            batchKey: 'logs',
            transport,
        })
    }

    private _logsUrl(): string {
        return (
            this._instance.requestRouter.endpointFor('api', LOGS_ENDPOINT) +
            '?token=' +
            encodeURIComponent(this._instance.config.token)
        )
    }

    private _getSdkContext(): LogSdkContext {
        const context: LogSdkContext = {}

        context.distinctId = this._instance.get_distinct_id()

        if (this._instance.sessionManager) {
            const { sessionId } = this._instance.sessionManager.checkAndGetSessionAndWindowId(true)
            context.sessionId = sessionId
        }

        if (assignableWindow?.location?.href) {
            context.currentUrl = assignableWindow.location.href
        }

        if (this._instance.featureFlags) {
            const flags = this._instance.featureFlags.getFlags()
            if (flags && flags.length > 0) {
                context.activeFeatureFlags = flags
            }
        }

        return context
    }
}
