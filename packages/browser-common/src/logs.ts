import type { CaptureLogOptions, Logger, OtlpLogsPayload } from '@posthog/types'
import type { RemoteConfigResult } from './types/remote-config'
import type { LogSdkContext } from '@posthog/core'
import {
    PostHogLogs as CorePostHogLogs,
    buildOtlpLogsPayload,
    buildResourceAttributes,
    isNullish,
    PostHogPersistedProperty,
} from '@posthog/core'
import type { BufferedLogEntry, ResolvedPostHogLogsConfig, SendLogsBatchOutcome } from '@posthog/core'
import type { Client, DeepReadonly } from './client'
import type { Disposable } from './disposable'
import type { Extension } from './extension'
import type { ConsoleLogsLoader } from './logs-types'
import { continueWith } from './utils/promise-utils'
import { addEventListener } from './utils/general-utils'
import { createLogger } from './utils/logger'
import { resolveLogsConfig, type BrowserLogsConfig, type LogsConfigSource } from './logs-config'
import { BUFFERED_CONSOLE_LEVELS } from './logs-types'
import type { BufferedConsoleEntry, BufferedConsoleLevel } from './logs-types'
import { patch } from './utils/patch'
import { originalConsoleMethod } from './utils/console-original'
import { isStatusZeroFailureCircuitBreakerTripped, updateStatusZeroFailureCount } from './utils/request-reachability'

// Backstop for a page where remote config or the logs script never settles the
// question: the buffer holds live references to console arguments, so it is
// released after this long regardless.
export const RECORDER_MAX_AGE_MS = 30000

// OTLP instrumentation-scope name for console auto-capture, distinguishing it from
// programmatic logs (which use the SDK scope) in scope-based dashboards/queries.
const CONSOLE_SCOPE_NAME = 'console'
// Backstop for a host request that never settles. Keep it above the transport's
// own 60s timeout so slow requests normally settle through the client first.
const LOGS_SEND_TIMEOUT_MS = 90000
// Mirrors the event retry queue's status-0 budget (see retry-queue.ts
// `STATUS_CODE_ZERO_MAX_RETRIES`): a request that dies before any HTTP response
// while the browser reports itself online is almost always deterministically
// blocked (ad blocker, CORS, extension), so retrying forever only burns network.
// After this many consecutive such failures we stop sending and drop batches;
// the `online` event reopens the pipe.
// NOTE: keep the constant value and the warning copy in sync with retry-queue.ts.
const MAX_CONSECUTIVE_STATUS_ZERO_FAILURES = 3
const HANDLED_LOGS_REQUEST_ERROR = '__posthogHandledLogsRequestError' as const

type HandledLogsRequestError = Error & { [HANDLED_LOGS_REQUEST_ERROR]: true }

const markLogsRequestErrorAsHandled = (error: unknown, fallbackMessage: string): HandledLogsRequestError => {
    const handledError = (error instanceof Error ? error : new Error(fallbackMessage)) as HandledLogsRequestError
    handledError[HANDLED_LOGS_REQUEST_ERROR] = true
    return handledError
}

const isHandledLogsRequestError = (error: unknown): error is HandledLogsRequestError =>
    !!error &&
    typeof error === 'object' &&
    (error as Partial<HandledLogsRequestError>)[HANDLED_LOGS_REQUEST_ERROR] === true

export class PostHogLogs implements Extension {
    readonly name: string = 'logs'
    private _isLogsEnabled: boolean = false
    private _isLoaded: boolean = false
    private _isLoading: boolean = false
    private _logger: Client['logger'] = createLogger('[logs]')
    // Core owns retry/backoff but the browser request layer owns transport logging.
    // Filter only errors explicitly branded by this adapter; fatal core errors remain visible.
    private get _coreLogger() {
        return {
            ...this._logger,
            error: (...args: any[]) => {
                if (!args.some(isHandledLogsRequestError)) {
                    this._logger.error(...args)
                }
            },
        }
    }

    // In-memory only; records do not survive a page reload.
    private _queue: BufferedLogEntry[] = []
    private _core: CorePostHogLogs | undefined
    private _resolvedConfig: ResolvedPostHogLogsConfig | undefined
    // The `logs` config the current `_core` was built from; a change rebuilds it.
    private _resolvedFrom: BrowserLogsConfig | undefined
    private _capture_logger: Logger | undefined

    // Console auto-capture uses a dedicated core + queue (its `service.name`
    // defaults to `posthog-browser-logs`). Built lazily, only when console runs.
    private _consoleQueue: BufferedLogEntry[] = []
    private _consoleCore: CorePostHogLogs | undefined
    private _consoleLogsDispose: (() => void) | undefined
    private _consoleResolvedConfig: ResolvedPostHogLogsConfig | undefined
    private _consoleResolvedFrom: BrowserLogsConfig | undefined

    // Shared across both cores: they send to the same endpoint, so one blocker
    // verdict covers both.
    private _consecutiveStatusZeroFailures = 0
    private _client: Client | undefined
    private _setupStarted = false
    private _remoteConfigSubscription: Disposable | undefined
    private _disposed = false

    // Console recorder: `console` is patched and the buffer fills until either the logs
    // script takes it over (`_takeConsoleBuffer`) or something drops it
    // (`_stopConsoleRecorder`).
    private _consoleBuffer: BufferedConsoleEntry[] = []
    private _consoleRecorderUnpatchers: (() => void)[] = []
    private _isRecordingConsole = false
    private _consoleRecorderTimeout: ReturnType<typeof setTimeout> | undefined
    // Mirrors the entrypoint's own guard. Snapshotting the SDK context reaches into
    // session, persistence and feature flags; anything on that path that writes
    // through the global `console` would re-enter the recorder while the outer entry
    // is still being built. `logger._log` escapes via `__rrweb_original__`;
    // `logger.critical` writes straight to the global `console`.
    private _isRecordingConsoleEntry = false

    private _window: (Window & typeof globalThis) | undefined
    private _listeningForReconnect = false

    constructor(
        private readonly _configSource: LogsConfigSource,
        /** Reads host SDK metadata at capture time, including while console calls are buffered. */
        private readonly _getSdkContext: () => LogSdkContext
    ) {
        this._isLogsEnabled = !!_configSource.get()?.captureConsoleLogs
    }

    protected get _isRequestReady(): boolean {
        return true
    }

    protected _getConsoleLoader(): ConsoleLogsLoader | undefined {
        return undefined
    }

    protected _listenForReconnect(): void {
        if (this._listeningForReconnect) return
        try {
            this._window = typeof window === 'undefined' ? undefined : window
        } catch {
            this._window = undefined
        }
        if (this._window) {
            addEventListener(this._window, 'online', this._onReconnect)
            this._listeningForReconnect = true
        }
    }

    private _onReconnect = (): void => {
        if (this._disposed) {
            return
        }
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
        this._listenForReconnect()
        const config = resolveLogsConfig(this._configSource.get(), opts)
        const core = new CorePostHogLogs(
            this._createHost(getQueue, setQueue),
            config,
            this._coreLogger,
            () => this._getSdkContext(),
            (fn) => fn(),
            undefined,
            scopeName
        )
        return [core, config]
    }

    private _getCore(): CorePostHogLogs {
        const logsConfig = this._configSource.get()
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
        const logsConfig = this._configSource.get()
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

    setup(client: Client): void | Promise<void> {
        if (this._disposed || this._setupStarted) {
            return
        }
        this._setupStarted = true
        this._client = client
        this._logger = client.logger.createLogger('[logs]')
        return continueWith(client.kv.initialize(), () => {
            if (!this._disposed) this._finishSetup(client)
        })
    }

    private _finishSetup(client: Client): void {
        this._listenForReconnect()
        // Non-slim bundles build this extension in the `PostHog` constructor, while
        // `config` is still the defaults, so the opt-in is re-read here.
        if (this._configSource.get()?.captureConsoleLogs) {
            this._isLogsEnabled = true
        }
        // Both routes to console capture have a window before the logs script can run,
        // so both get a recorder. Local config is the caller's own opt-in for this page
        // load; a persisted `true` is only a hint remote config may since have withdrawn.
        // Neither emits anything here. Started before subscribing, because a replayed
        // config calls back synchronously.
        if (
            this._isLogsEnabled ||
            (this._configSource.remoteConfigWillArrive && client.kv.get(this._configSource.captureHintKey))
        ) {
            this._startConsoleRecorder()
        }
        let replayedEnabledConfig = false
        const subscription = client.onRemoteConfig((result) => {
            replayedEnabledConfig = result.ok && result.config.logs?.captureConsoleLogs === true
            this.onRemoteConfig(result)
        })
        if (this._disposed) {
            subscription.dispose()
            return
        }
        this._remoteConfigSubscription = subscription
        if (!replayedEnabledConfig) {
            this.loadIfEnabled()
        }
    }

    dispose(): void {
        if (this._disposed) {
            return
        }
        this._disposed = true
        this._stopConsoleRecorder()
        this._remoteConfigSubscription?.dispose()
        this._remoteConfigSubscription = undefined
        this._client = undefined
        this._isLoading = false
        this._window?.removeEventListener('online', this._onReconnect)
        // TODO: Multiplex console capture across instances and settle pending log sends so
        // wrappers and request timers cannot outlive their final owner.
        this._consoleLogsDispose?.()
        this._consoleLogsDispose = undefined
        this._core?.clearQueue()
        this._consoleCore?.clearQueue()
        this._core?.reset()
        this._consoleCore?.reset()
    }

    onRemoteConfig(result: DeepReadonly<RemoteConfigResult>): void {
        if (this._disposed) {
            return
        }

        // A failed fetch and a response without a `logs` key behave the same: no fresh
        // verdict arrived.
        const logCapture = result.ok ? result.config.logs?.captureConsoleLogs : undefined
        if (isNullish(logCapture)) {
            // Nothing to persist, and a recorder the hint alone started stands down
            // rather than holding console arguments for a handover that may never come.
            this._stopRecorderStartedByPersistedHint()
            return
        }
        this._client?.kv.set(this._configSource.captureHintKey, !!logCapture)
        if (!logCapture) {
            // The server reports `false` for every project that has not turned console
            // capture on, so it cannot distinguish "not enabled" from "turned off" and
            // does not override a local `captureConsoleLogs` opt-in. It does withdraw the
            // persisted hint, which is the only thing it granted.
            this._stopRecorderStartedByPersistedHint()
            return
        }
        this._isLogsEnabled = true
        if (!this._isLoaded) {
            // On a first visit there is no local option and no persisted hint, so `setup`
            // started no recorder and this is the first thing to enable capture. The
            // script it kicks off below does not land in the same tick, and console calls
            // made in between would otherwise fall through the gap. The recorder runs
            // until `loadIfEnabled` hands its buffer to the script.
            this._startConsoleRecorder()
        }
        this.loadIfEnabled()
    }

    reset(): void {
        // Buffered entries carry the pre-reset identity, so they are dropped rather
        // than replayed under whoever the SDK is told to be next.
        this._stopConsoleRecorder()
        this._core?.clearQueue()
        this._queue = []
        this._core?.reset()
        this._consoleCore?.clearQueue()
        this._consoleQueue = []
        this._consoleCore?.reset()
        this._consecutiveStatusZeroFailures = 0
    }

    captureLog(options: CaptureLogOptions): void {
        if (!this._disposed && this._client) {
            this._getCore().captureLog(options)
        }
    }

    // Console auto-capture (the lazy `logs` chunk) routes here so its records run
    // through the shared core pipeline and carry `service.name: posthog-browser-logs`.
    /** @internal */
    captureConsoleLog(options: CaptureLogOptions): void {
        if (!this._disposed && this._client) {
            this._getConsoleCore().captureLog(options)
        }
    }

    // Replay path for entries the recorder buffered before the `logs` chunk existed.
    // Same pipeline as `captureConsoleLog`, but the record is stamped with the state
    // captured at the console call rather than the state at replay. Unmangled for the
    // same reason `captureConsoleLog` is: the caller lives in a separately built bundle.
    /** @internal */
    captureBufferedConsoleLog(options: CaptureLogOptions, context: LogSdkContext, occurredAtMs: number): void {
        if (!this._disposed && this._client) {
            this._getConsoleCore().captureLog(options, { context, occurredAtMs })
        }
    }

    /**
     * Releases everything console capture is holding when capturing is turned off: the
     * pre-load buffer, the `console` patches, and console records already queued — at
     * that moment rather than whenever the page next writes to the console.
     *
     * @internal
     */
    _onOptOut(): void {
        this._stopConsoleRecorder()
        // Console autocapture is passive mirroring the app never asked for, so records
        // already queued go too. `captureLog`/`logger` records were captured explicitly
        // while consent stood, so `_queue` is left alone and a flush already armed will
        // still send them — the same as events queued before an opt-out.
        this._consoleCore?.clearQueue()
        this._consoleQueue = []
    }

    // Withdraws a recorder that nothing but the persisted hint ever granted. A running
    // recorder with `_isLogsEnabled` unset can only have come from the hint, and once it
    // is set capture has been granted for real and the handover is coming — so the hint
    // is no longer the only thing holding the recorder up.
    private _stopRecorderStartedByPersistedHint(): void {
        if (this._isLogsEnabled) {
            return
        }
        this._stopConsoleRecorder()
    }

    private _startConsoleRecorder(): void {
        if (this._isRecordingConsole || !this._window?.console) {
            return
        }
        // Deliberately tighter than the console queue's own depth: entries here pin
        // live argument graphs rather than serialized records, so the ceiling is core's
        // flush threshold rather than its eviction cap.
        const maxBufferSize = resolveLogsConfig(this._configSource.get()).maxBufferSize
        // Foreign wrappers can retain this installation after stop. Restarting the
        // instance must not reactivate those older recorder closures.
        let active = true
        this._consoleRecorderUnpatchers.push(() => {
            active = false
        })
        for (const level of BUFFERED_CONSOLE_LEVELS) {
            let trueOriginal: any
            try {
                trueOriginal = originalConsoleMethod(this._window!.console[level])
            } catch {
                // A hostile `console` accessor must not take the whole logs extension
                // down with it: the runtime disposes an extension whose setup throws.
                continue
            }
            if (!trueOriginal) {
                continue
            }
            this._consoleRecorderUnpatchers.push(
                patch(this._window!.console, level, (next: any) => {
                    const wrapped = (...args: any[]) => {
                        try {
                            if (active) {
                                this._recordConsoleEntry(level, args, maxBufferSize)
                            }
                        } catch {
                            // Recording must never break the page's own console output.
                        }
                        return next.apply(this._window!.console, args)
                    }
                    // Later patchers walk this marker to reach the real console method
                    // instead of re-entering the recorder.
                    ;(wrapped as any).__rrweb_original__ = trueOriginal
                    return wrapped
                })
            )
        }
        this._isRecordingConsole = true
        this._consoleRecorderTimeout = setTimeout(() => {
            this._stopConsoleRecorder()
        }, RECORDER_MAX_AGE_MS)
    }

    // Keeps the earliest calls on overflow rather than evicting oldest-first like the
    // logs queue: the early ones are exactly what the live path would otherwise miss.
    private _recordConsoleEntry(level: BufferedConsoleLevel, args: any[], maxBufferSize: number): void {
        if (!this._isRecordingConsole || this._isRecordingConsoleEntry || args.length === 0) {
            return
        }
        if (!this._client?.canCapture) {
            // Opting out mid-window releases the arguments already held, not just
            // future ones.
            this._stopConsoleRecorder()
            return
        }
        if (this._consoleBuffer.length >= maxBufferSize) {
            return
        }
        this._isRecordingConsoleEntry = true
        try {
            this._consoleBuffer.push({ level, args, occurredAtMs: Date.now(), context: this._getSdkContext() })
        } finally {
            this._isRecordingConsoleEntry = false
        }
    }

    // Stops recording and drops anything buffered, releasing the live argument
    // references. `_takeConsoleBuffer` takes the buffer before calling this.
    private _stopConsoleRecorder(): void {
        this._consoleBuffer = []
        if (!this._isRecordingConsole) {
            return
        }
        this._isRecordingConsole = false
        if (this._consoleRecorderTimeout) {
            clearTimeout(this._consoleRecorderTimeout)
            this._consoleRecorderTimeout = undefined
        }
        for (const unpatch of this._consoleRecorderUnpatchers) {
            unpatch()
        }
        this._consoleRecorderUnpatchers = []
    }

    private _takeConsoleBuffer(): BufferedConsoleEntry[] {
        const buffered = this._consoleBuffer
        this._stopConsoleRecorder()
        return buffered
    }

    get logger(): Logger {
        if (!this._capture_logger) {
            // Preserve explicit undefined attributes passed to beforeSend callbacks.
            /* oxlint-disable typescript/consistent-type-assertions */
            this._capture_logger = {
                trace: (body, attributes) => this.captureLog({ body, level: 'trace', attributes } as CaptureLogOptions),
                debug: (body, attributes) => this.captureLog({ body, level: 'debug', attributes } as CaptureLogOptions),
                info: (body, attributes) => this.captureLog({ body, level: 'info', attributes } as CaptureLogOptions),
                warn: (body, attributes) => this.captureLog({ body, level: 'warn', attributes } as CaptureLogOptions),
                error: (body, attributes) => this.captureLog({ body, level: 'error', attributes } as CaptureLogOptions),
                fatal: (body, attributes) => this.captureLog({ body, level: 'fatal', attributes } as CaptureLogOptions),
            }
            /* oxlint-enable typescript/consistent-type-assertions */
        }
        return this._capture_logger
    }

    // An explicit transport drains the whole queue in one request over that transport
    // (core's batched flush can't force a transport, and the unload sendBeacon must be
    // synchronous). No transport → core's batched, 413-aware, retrying flush.
    flushLogs(transport?: 'XHR' | 'fetch' | 'sendBeacon'): void {
        if (!this._client) return
        if (transport) {
            this._flushViaTransport(transport)
            return
        }
        if (this._core) {
            void this._core.flush().catch((err) => this._logFlushError(err))
        }
        if (this._consoleCore) {
            void this._consoleCore.flush().catch((err) => this._logFlushError(err))
        }
    }

    private _logFlushError(error: unknown): void {
        if (!isHandledLogsRequestError(error)) {
            this._logger.error('PostHog logs flush failed:', error)
        }
    }

    loadIfEnabled(): void {
        if (this._disposed || !this._isLogsEnabled || this._isLoaded || this._isLoading) {
            return
        }

        const loadConsole = this._getConsoleLoader()
        if (!loadConsole) {
            this._stopConsoleRecorder()
            return
        }

        this._isLoading = true
        try {
            loadConsole((err, logsExtension) => {
                this._isLoading = false
                if (this._disposed || !this._isLogsEnabled) {
                    // Remote config turned capture off while the script was in flight.
                    return
                }
                if (err || !logsExtension) {
                    this._logger.error('Could not load logs script', err)
                    this._stopConsoleRecorder()
                } else {
                    // Unpatch the recorder before the entrypoint patches `console`, so a
                    // call made in this tick is either buffered or captured live, never
                    // both. Both steps run synchronously here, so stopping first opens no
                    // capture gap.
                    const buffered = this._takeConsoleBuffer()
                    this._consoleLogsDispose = logsExtension.initialize(this._client!)
                    this._isLoaded = true
                    if (buffered.length > 0) {
                        logsExtension.replay(this._client!, buffered)
                    }
                }
            })
        } catch (error) {
            this._isLoading = false
            throw error
        }
    }

    // Host adapter for core's `PostHogLogs`; structurally checked against `LogsHost`
    // at the `new CorePostHogLogs` call, so no explicit annotation is needed. The
    // queue accessors are parameterized so the programmatic and console instances
    // each bind to their own queue.
    private _createHost(getQueue: () => BufferedLogEntry[], setQueue: (q: BufferedLogEntry[]) => void) {
        const client = this._client!
        return {
            // The browser gates capture through `is_capturing()` (see `optedOut`).
            get isDisabled() {
                return false
            },
            get optedOut() {
                return !client.canCapture
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
            getLibraryId: () => client.library.name,
            getLibraryVersion: () => client.library.version,
        }
    }

    private _sendLogsBatch(payload: OtlpLogsPayload): Promise<SendLogsBatchOutcome> {
        // oxlint-disable-next-line compat/compat
        return new Promise((resolve) => {
            if (
                isStatusZeroFailureCircuitBreakerTripped(
                    this._consecutiveStatusZeroFailures,
                    MAX_CONSECUTIVE_STATUS_ZERO_FAILURES
                )
            ) {
                // Tripped: drop the batch without touching the network. `fatal`
                // advances the queue so records don't pile up while blocked.
                // The `onLine` guard ensures genuine offline periods still queue
                // for the reconnect flush instead of being fatally dropped.
                resolve({
                    kind: 'fatal',
                    error: markLogsRequestErrorAsHandled(undefined, 'logs endpoint is unreachable, dropping batch'),
                })
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

            // A host request must not wedge the queue indefinitely. Keep records for retry.
            const timer = setTimeout(() => {
                this._logger.warn('Logs request timed out before receiving a response')
                settle({
                    kind: 'retry-later',
                    error: markLogsRequestErrorAsHandled(undefined, 'logs request timed out'),
                })
            }, LOGS_SEND_TIMEOUT_MS)

            const isRequestReady = this._isRequestReady
            this._client!.sendRequest('/i/v1/logs', {
                method: 'POST',
                query: { token: this._client!.projectToken },
                body: payload,
                compression: 'best-available',
                timeoutMs: 60_000,
            }).then(
                (response) => {
                    const status = response.statusCode
                    this._trackEndpointReachability(status, isRequestReady)
                    if (status >= 200 && status < 300) {
                        settle({ kind: 'ok' })
                    } else if (status === 413) {
                        settle({ kind: 'too-large' })
                    } else if (status === 0 || status === 408 || status === 429 || status >= 500) {
                        // Transient (network / timeout / rate-limit / server error): keep and retry.
                        if (status === 0) {
                            // `_send_request` already logs fetch failures. Bare status 0 is the
                            // XHR/synthetic path, so keep one warning for it here.
                            if (!response.error) {
                                this._logger.warn('Logs request failed before receiving an HTTP response')
                            }
                            settle({
                                kind: 'retry-later',
                                error: markLogsRequestErrorAsHandled(
                                    response.error,
                                    'logs request failed before receiving an HTTP response'
                                ),
                            })
                        } else {
                            // Preserve error severity for real HTTP failures.
                            settle({
                                kind: 'retry-later',
                                error: response.error ?? new Error(`logs request failed with status ${status}`),
                            })
                        }
                    } else {
                        // Client error (4xx): won't succeed on retry, drop.
                        settle({ kind: 'fatal', error: new Error(`logs request failed with status ${status}`) })
                    }
                },
                (error) => {
                    settle({ kind: 'retry-later', error })
                }
            )
        })
    }

    // Feeds the status-0 circuit breaker checked at the top of `_sendLogsBatch`.
    private _trackEndpointReachability(statusCode: number, isRequestReady: boolean): void {
        // A pre-initialization drop is not evidence that the endpoint is blocked,
        // even if initialization ran before the response Promise settled.
        if (statusCode === 0 && !isRequestReady) return
        this._consecutiveStatusZeroFailures = updateStatusZeroFailureCount(
            statusCode,
            this._consecutiveStatusZeroFailures,
            MAX_CONSECUTIVE_STATUS_ZERO_FAILURES,
            () =>
                this._logger.warn(
                    'Log requests are failing before receiving an HTTP response; this can happen due to network issues, CORS, browser blocking, or ad blockers. Stopped sending logs; will try again when connectivity changes.'
                )
        )
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
            this._drainQueueViaTransport(
                transport,
                this._queue,
                this._resolvedConfig!,
                this._client!.library.name,
                (q) => {
                    this._queue = q
                }
            )
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
        // the SDK id (`this._client!.library.name`) regardless.
        const payload = buildOtlpLogsPayload(
            records,
            buildResourceAttributes(config, this._client!.library.name, this._client!.library.version),
            scopeName,
            this._client!.library.version
        )
        // Intentionally bypasses the circuit breaker and does not feed
        // `_trackEndpointReachability`: this is a best-effort "last gasp" send
        // (page unload or explicit transport flush) where `sendBeacon` in particular
        // is sometimes honoured even by blockers, and the callback-less path means
        // we can't track the outcome anyway.
        void this._client!.sendRequest('/i/v1/logs', {
            method: 'POST',
            query: { token: this._client!.projectToken },
            body: payload,
            compression: 'best-available',
            transport,
            timeoutMs: 60_000,
        }).catch((error) => this._logFlushError(error))
    }
}
