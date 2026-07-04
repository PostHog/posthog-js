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
    stripUrlHash,
} from '@posthog/core'
import type { BufferedLogEntry, ResolvedPostHogLogsConfig, SendLogsBatchOutcome } from '@posthog/core'
import { assignableWindow, window } from './utils/globals'
import { addEventListener } from './utils'
import { createLogger } from './utils/logger'
import { Extension } from './extensions/types'
import { resolveLogsConfig } from './logs-defaults'

const LOGS_ENDPOINT = '/i/v1/logs'
// OTLP instrumentation-scope name for console auto-capture, distinguishing it from
// programmatic logs (which use the SDK scope) in scope-based dashboards/queries.
const CONSOLE_SCOPE_NAME = 'console'
// Safety backstop for a `_send_request` that never calls back. Set above the
// request layer's own 60s timeout so a real (slow-but-completing) request always
// settles via its callback first; this only fires on a genuinely callback-less
// send (e.g. request enqueued before load, or a transport that never reports).
const LOGS_SEND_TIMEOUT_MS = 90000
// Mirrors the event retry queue's status-0 budget: a request that dies before any
// HTTP response while the browser reports itself online is almost always
// deterministically blocked (ad blocker, CORS, extension), so retrying forever
// only burns network. After this many consecutive such failures we stop sending
// and drop batches; the `online` event reopens the pipe.
const MAX_CONSECUTIVE_STATUS_ZERO_FAILURES = 3

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

    // Console auto-capture uses a dedicated core + queue (its `service.name`
    // defaults to `posthog-browser-logs`). Built lazily, only when console runs.
    private _consoleQueue: BufferedLogEntry[] = []
    private _consoleCore: CorePostHogLogs | undefined
    private _consoleResolvedConfig: ResolvedPostHogLogsConfig | undefined
    private _consoleResolvedFrom: PostHog['config']['logs']

    // Shared across both cores: they send to the same endpoint, so one blocker
    // verdict covers both.
    private _consecutiveStatusZeroFailures = 0

    constructor(private readonly _instance: PostHog) {
        if (this._instance && this._instance.config.logs?.captureConsoleLogs) {
            this._isLogsEnabled = true
        }
        // Flush on reconnect rather than waiting out the retry backoff.
        if (window) {
            addEventListener(window, 'online', this._onReconnect)
        }
    }

    private _onReconnect = (): void => {
        this._consecutiveStatusZeroFailures = 0
        this._core?.onReconnect()
        this._consoleCore?.onReconnect()
    }

    // Cores are built lazily (the extension exists before `init` applies config)
    // and rebuilt when `config.logs` is swapped. Callers reset the old core first
    // so its timer can't double-flush the shared queue; a flush already in flight
    // may still re-send its head batch on a mid-swap — a duplicate, never a loss.
    private _buildCore(
        getQueue: () => BufferedLogEntry[],
        setQueue: (q: BufferedLogEntry[]) => void,
        opts?: Parameters<typeof resolveLogsConfig>[1],
        scopeName?: string
    ): [CorePostHogLogs, ResolvedPostHogLogsConfig] {
        const config = resolveLogsConfig(this._instance?.config?.logs, opts)
        const core = new CorePostHogLogs(
            this._createHost(getQueue, setQueue),
            config,
            this._logger,
            () => this._getSdkContext(),
            (fn) => fn(),
            undefined,
            scopeName
        )
        return [core, config]
    }

    private _getCore(): CorePostHogLogs {
        const logsConfig = this._instance?.config?.logs
        if (!this._core || this._resolvedFrom !== logsConfig) {
            this._core?.reset()
            this._resolvedFrom = logsConfig
            ;[this._core, this._resolvedConfig] = this._buildCore(
                () => this._queue,
                (q) => {
                    this._queue = q
                }
            )
        }
        return this._core
    }

    // Like `_getCore`, but with the console service name + scope, backed by `_consoleQueue`.
    private _getConsoleCore(): CorePostHogLogs {
        const logsConfig = this._instance?.config?.logs
        if (!this._consoleCore || this._consoleResolvedFrom !== logsConfig) {
            this._consoleCore?.reset()
            this._consoleResolvedFrom = logsConfig
            ;[this._consoleCore, this._consoleResolvedConfig] = this._buildCore(
                () => this._consoleQueue,
                (q) => {
                    this._consoleQueue = q
                },
                { serviceNameDefault: 'posthog-browser-logs', consoleCapture: true },
                CONSOLE_SCOPE_NAME
            )
        }
        return this._consoleCore
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
        this._consoleQueue = []
        this._consoleCore?.reset()
    }

    captureLog(options: CaptureLogOptions): void {
        this._getCore().captureLog(options)
    }

    // Console auto-capture (the lazy `logs` chunk) routes here so its records run
    // through the shared core pipeline and carry `service.name: posthog-browser-logs`.
    /** @internal */
    _captureConsoleLog(options: CaptureLogOptions): void {
        this._getConsoleCore().captureLog(options)
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
        if (this._core) {
            void this._core.flush().catch((err) => this._logger.error('PostHog logs flush failed:', err))
        }
        if (this._consoleCore) {
            void this._consoleCore.flush().catch((err) => this._logger.error('PostHog logs flush failed:', err))
        }
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
    // at the `new CorePostHogLogs` call, so no explicit annotation is needed. The
    // queue accessors are parameterized so the programmatic and console instances
    // each bind to their own queue.
    private _createHost(getQueue: () => BufferedLogEntry[], setQueue: (q: BufferedLogEntry[]) => void) {
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
                key === PostHogPersistedProperty.LogsQueue ? (getQueue() as unknown as T) : undefined,
            setPersistedProperty: <T>(key: PostHogPersistedProperty, value: T | null): void => {
                if (key === PostHogPersistedProperty.LogsQueue) {
                    setQueue((value as unknown as BufferedLogEntry[]) ?? [])
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
            if (this._consecutiveStatusZeroFailures >= MAX_CONSECUTIVE_STATUS_ZERO_FAILURES) {
                // Tripped: drop the batch without touching the network. `fatal`
                // advances the queue so records don't pile up while blocked.
                resolve({ kind: 'fatal', error: new Error('logs endpoint is unreachable, dropping batch') })
                return
            }

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
                    this._trackEndpointReachability(status)
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

    // Feeds the status-0 circuit breaker checked at the top of `_sendLogsBatch`.
    private _trackEndpointReachability(statusCode: number): void {
        if (statusCode === 0) {
            // `onLine === false` is genuine offline: those records wait for the
            // reconnect flush, so they don't count toward the trip.
            if (window?.navigator.onLine !== false) {
                this._consecutiveStatusZeroFailures++
                if (this._consecutiveStatusZeroFailures === MAX_CONSECUTIVE_STATUS_ZERO_FAILURES) {
                    this._logger.warn(
                        'Log requests are failing before receiving an HTTP response; this can happen due to network issues, CORS, browser blocking, or ad blockers. Stopped sending logs; will try again when connectivity changes.'
                    )
                }
            }
        } else {
            // Any HTTP response proves the endpoint is reachable.
            this._consecutiveStatusZeroFailures = 0
        }
    }

    // Drains both the programmatic and console queues over the given transport.
    // Each queue carries its own resolved config so the two `service.name`s are
    // preserved. Non-empty queue → its core was built → its resolved config is set,
    // so the length guards also avoid lazily building an unused core for config.
    // TODO: future optimization — merge both into one multi-`resourceLogs` payload
    //       so a page-unload only fires a single sendBeacon instead of two.
    private _flushViaTransport(transport: 'XHR' | 'fetch' | 'sendBeacon'): void {
        if (this._queue.length > 0) {
            // Invariant: _resolvedConfig is set whenever _queue has items.
            this._drainQueueViaTransport(transport, this._queue, this._resolvedConfig!, Config.LIB_NAME, (q) => {
                this._queue = q
            })
        }
        if (this._consoleQueue.length > 0) {
            // Invariant: _consoleResolvedConfig is set whenever _consoleQueue has items.
            this._drainQueueViaTransport(
                transport,
                this._consoleQueue,
                this._consoleResolvedConfig!,
                CONSOLE_SCOPE_NAME,
                (q) => {
                    this._consoleQueue = q
                }
            )
        }
    }

    private _drainQueueViaTransport(
        transport: 'XHR' | 'fetch' | 'sendBeacon',
        queue: BufferedLogEntry[],
        config: ResolvedPostHogLogsConfig,
        scopeName: string,
        setQueue: (q: BufferedLogEntry[]) => void
    ): void {
        if (queue.length === 0) {
            return
        }
        const records = queue.map((e) => e.record)
        setQueue([])
        // Shared with the core flush path so resource attributes can't drift. The
        // scope name labels the stream (console vs SDK); `telemetry.sdk.name` stays
        // the SDK id (`Config.LIB_NAME`) regardless.
        const payload = buildOtlpLogsPayload(
            records,
            buildResourceAttributes(config, Config.LIB_NAME, Config.LIB_VERSION),
            scopeName,
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
            const { sessionId, windowId, sessionStartTimestamp, lastActivityTimestamp } =
                this._instance.sessionManager.checkAndGetSessionAndWindowId(true)
            context.sessionId = sessionId
            context.windowId = windowId
            if (!isNullish(sessionStartTimestamp)) {
                context.sessionStartTimestamp = sessionStartTimestamp
            }
            if (!isNullish(lastActivityTimestamp)) {
                context.lastActivityTimestamp = lastActivityTimestamp
            }
        }

        if (assignableWindow?.location?.href) {
            context.currentUrl = this._instance.config.disable_capture_url_hashes
                ? stripUrlHash(assignableWindow.location.href)
                : assignableWindow.location.href
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
