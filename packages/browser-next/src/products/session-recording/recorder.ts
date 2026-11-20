import { getRecordConsolePlugin, record } from './rrweb'
import type {
    CapturedEventInfo,
    SessionContext,
    SessionRecordingPersistedConfig,
    SessionStartReason,
} from '@posthog/browser-common'
import { buildNetworkRequestOptions } from '@posthog/browser-common/replay/network-config'
import { getRecordNetworkPlugin } from '@posthog/browser-common/replay/network-plugin'
import { MutationThrottler } from '@posthog/browser-common/replay/mutation-throttler'
import { isLocalhost } from '@posthog/browser-common/utils/request-utils'
import {
    SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION,
    SESSION_RECORDING_IS_SAMPLED,
    SESSION_RECORDING_OVERRIDE_EVENT_TRIGGER,
    SESSION_RECORDING_OVERRIDE_LINKED_FLAG,
    SESSION_RECORDING_OVERRIDE_SAMPLING,
    SESSION_RECORDING_OVERRIDE_URL_TRIGGER,
    SESSION_RECORDING_SAMPLE_RATE,
    SESSION_RECORDING_START_REASON,
    SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION,
} from '@posthog/browser-common/replay/replay-constants'
import {
    decodeSamplingDecision,
    V1RecordingStrategy,
    V2TriggerGroupStrategy,
    type RecordingStrategy,
} from '@posthog/browser-common/replay/recording-strategies'
import type { recordOptions, rrwebRecord as RrwebRecord } from '@posthog/browser-common/replay/rrweb'
import {
    EventType,
    IncrementalSource,
    type eventWithTime,
    type listenerHandler,
    type RecordPlugin,
} from '@posthog/browser-common/replay/rrweb-types'
import {
    splitBuffer,
    truncateLargeConsoleLogs,
    UNSTRINGIFIABLE_EVENT_SIZE,
    type SnapshotBuffer,
} from '@posthog/browser-common/replay/sessionrecording-utils'
import {
    ACTIVE,
    BUFFERING,
    DISABLED,
    EventTriggerMatching,
    LinkedFlagMatching,
    PAUSED,
    SAMPLED,
    URLTriggerMatching,
    type SessionRecordingStatus,
    type TriggerType,
} from '@posthog/browser-common/replay/trigger-matching'
import type { CaptureResult } from '@posthog/types'
import type { Disposable, KeyValueStore } from '@posthog/browser-common'
import { compressEventSync } from '@posthog/browser-common/replay/event-compression'

import { createId } from '../../primitives/id'
import { version } from '../../primitives/version'
import type { IPostHog } from '../../core/types'
import type { BrowserState } from '../../core/state/state'
import { analyticsOf, type Analytics } from '../analytics/analytics-core'
import { createReplayTriggerHost, type ReplayDebugHost } from './replay-trigger-host'
import { createSnapshotDelivery, type SnapshotDelivery } from './snapshot-delivery'
import type { SessionRecordingOptions } from './session-recording-options'

const FIVE_MINUTES = 5 * 60 * 1000
const ONE_MINUTE = 60 * 1000
const FLUSH_DELAY_MS = 2000
// replay interactions arrive many times a second; the session only needs extending about once a second
const SESSION_TOUCH_INTERVAL_MS = 1000
// each `$snapshot` stays below ~1MB so ingestion never rejects it
const MAX_SNAPSHOT_BYTES = 1024 * 1024 * 0.9
const DEFAULT_ENDPOINT = '/s/'
const MAX_SESSION_LENGTH = 24 * 60 * 60 * 1000

const USER_INTERACTION_SOURCES: readonly number[] = [
    IncrementalSource.MouseMove,
    IncrementalSource.MouseInteraction,
    IncrementalSource.Scroll,
    IncrementalSource.ViewportResize,
    IncrementalSource.Input,
    IncrementalSource.TouchMove,
    IncrementalSource.MediaInteraction,
    IncrementalSource.Drag,
]

const isCustomEvent = (event: eventWithTime, tag: string): boolean =>
    event.type === EventType.Custom && (event.data as { tag?: unknown }).tag === tag

type BufferedSnapshot = SnapshotBuffer & { distinctId: string }

const PARKED_BUFFER_KEY = 'pendingBuffer'

/** The client's tab-scoped storage, which ends with the tab, as posthog-js parks buffers in sessionStorage. */
interface ParkingAccess {
    readonly _state: Pick<BrowserState, 'tabKeyValueStore'>
}

/** The client capabilities and state the recorder reads from the session recording extension. */
export interface RecorderHost {
    readonly client: IPostHog
    readonly options: SessionRecordingOptions
    /** The persisted remote replay configuration. */
    remoteConfig(): SessionRecordingPersistedConfig | undefined
    /** Whether the project accepts gzip request bodies. */
    gzipEnabled(): boolean
    documentWasEverVisible(): boolean
    /** Events admitted before the recorder first started. Later calls return none. */
    takeEarlyEvents(): readonly CapturedEventInfo[]
}

const recordFunction = record as unknown as RrwebRecord

/** A number from 0 to `max`, parsing numeric strings, or `fallback` when there is none. */
const clamp = (value: unknown, max: number, fallback: number): number => {
    const number = typeof value === 'string' ? parseFloat(value) : value
    return Number.isFinite(number) ? Math.min(Math.max(number as number, 0), max) : fallback
}

/**
 * Records replay activity that is not a captured event on the current session, rotating an expired
 * session as a captured event would. Returns the active session, or `undefined` when capture is not
 * permitted or another tab owns the session.
 */
const touchSession = (analytics: Analytics, now?: number): SessionContext | undefined => {
    if (analytics._disposed || !analytics._core.canCapture) return undefined
    const prepared = analytics._core._state.prepareSessionForEvent(now)
    if (!analytics._core._state.sessionAdmitted(prepared)) return undefined
    const session = prepared.context
    analytics._sessionProperties.admitted(session.sessionId)
    if (prepared.reason) analytics._newSessionPublisher.publish({ ...session, reason: prepared.reason })
    return session
}

/**
 * Runs rrweb for the current session and delivers its events as `$snapshot` batches. It follows
 * posthog-js's recorder: idle detection, session rotation, the interaction hold for epochs nobody
 * interacted with, minimum duration, URL blocklist pauses, and the shared trigger and sampling strategies.
 */
export class SessionRecorder {
    private readonly _client: IPostHog
    private readonly _analytics: Analytics | undefined
    private readonly _triggerHost: ReplayDebugHost
    private readonly _delivery: SnapshotDelivery
    private readonly _urlTriggerMatching: URLTriggerMatching
    private readonly _eventTriggerMatching: EventTriggerMatching
    private readonly _linkedFlagMatching: LinkedFlagMatching
    private _strategy: RecordingStrategy | undefined
    private _config: SessionRecordingPersistedConfig | undefined
    private _stopRrweb: listenerHandler | undefined
    private _mutationThrottler: MutationThrottler | undefined
    private _rrwebError = false
    private _sessionId = ''
    private _windowId = ''
    private _sessionStartTimestamp = 0
    private _buffer: BufferedSnapshot
    private _isIdle: boolean | 'unknown' = 'unknown'
    private _lastActivityTimestamp = Date.now()
    private _holdFlushUntilInteraction = false
    private _heldEpochShipsOnUnload = false
    private _heldBufferOverflowed = false
    private _suppressNextFreshStartHold = false
    private _lastFullSnapshotSessionId: string | undefined
    private _lastHref: string | undefined
    private _flushTimer: ReturnType<typeof setTimeout> | undefined
    private _fullSnapshotTimer: ReturnType<typeof setInterval> | undefined
    private _subscriptions: Disposable[] = []
    private _removeEventTriggerListener: (() => void) | undefined
    private _touchingSession = false
    private _lastTouchTimestamp = 0
    private _restarting = false
    private _activatingTrigger = false
    private _disposed = false
    private _parking: KeyValueStore | undefined
    private _parkedBufferSize: number | undefined
    private _parkedBufferRestored = false

    constructor(private readonly _host: RecorderHost) {
        this._client = _host.client
        this._analytics = analyticsOf(this._client)
        this._triggerHost = createReplayTriggerHost(this._client)
        this._urlTriggerMatching = new URLTriggerMatching(this._triggerHost)
        this._eventTriggerMatching = new EventTriggerMatching(this._triggerHost)
        this._linkedFlagMatching = new LinkedFlagMatching(this._triggerHost)
        this._delivery = createSnapshotDelivery({
            runtime: this._analytics!._core._requestRuntime,
            endpoint: () => this._config?.endpoint || DEFAULT_ENDPOINT,
            // core owns delivery authority, so replay follows the same consent rule as analytics
            canDeliver: () => this._analytics!._core._canDeliver(),
            gzipEnabled: () => _host.gzipEnabled(),
            reportFailure: (error) => this._client.logger.error('Session recording delivery failed', error),
            reportWarning: (message) => this._client.logger.warn(message),
        })
        this._buffer = this._emptyBuffer()
    }

    get isStarted(): boolean {
        return !!this._stopRrweb
    }

    get sessionId(): string {
        return this._sessionId
    }

    get status(): SessionRecordingStatus {
        if (!this._strategy) return DISABLED
        return this._strategy.getStatus({
            instance: this._triggerHost,
            sessionId: this._sessionId,
            isSampled: decodeSamplingDecision(this._client.kv.get(SESSION_RECORDING_IS_SAMPLED), this._sessionId),
            rrwebError: this._rrwebError,
            urlTriggerMatching: this._urlTriggerMatching,
            eventTriggerMatching: this._eventTriggerMatching,
            linkedFlagMatching: this._linkedFlagMatching,
            remoteConfig: this._config,
        })
    }

    /** The replay debug properties for an event; only some SDK events also carry the optional ones. */
    debugProperties(optional: boolean): Record<string, unknown> {
        // a stopped recorder reports itself disabled, though its last strategy still answers status reads
        const status = this.isStarted || this._rrwebError ? this.status : DISABLED
        return {
            $recording_status: status,
            $sdk_debug_replay_internal_buffer_length: this._buffer.data.length,
            $sdk_debug_replay_rrweb_error: this._rrwebError,
            ...(optional
                ? {
                      ...this._triggerHost.optionalDebugProperties(),
                      $sdk_debug_replay_internal_buffer_size: this._buffer.size,
                      // the recorder adopts a rotated session only after the event that rotates it, which must not carry the old start
                      ...(this._sessionStartTimestamp &&
                      this._sessionId === this._analytics?._core._state.activeSessionId
                          ? { $sdk_debug_session_start: this._sessionStartTimestamp }
                          : {}),
                      // as in posthog-js, conditions are only pending while they hold the recording in a buffer
                      $sdk_debug_replay_pending_trigger_conditions:
                          status === BUFFERING
                              ? (this._strategy?.getPendingTriggerConditions(this._sessionId) ?? [])
                              : [],
                      ...(this._holdFlushUntilInteraction
                          ? {
                                $sdk_debug_replay_flush_hold_reason: this._heldEpochShipsOnUnload
                                    ? 'no_interaction_since_recording_started'
                                    : 'no_interaction_since_session_rotated',
                            }
                          : {}),
                  }
                : {}),
        }
    }

    start(startReason?: SessionStartReason): void {
        if (this._disposed) return
        const config = this._host.remoteConfig()
        if (!config) return
        this._config = config

        if (!this.isStarted) {
            // an epoch that starts without user activity is held until someone interacts, so an
            // untouched tab (prefetch, background load) does not ship a recording
            const holdFreshStart = this._isIdle !== false && !this._suppressNextFreshStartHold
            this._holdFlushUntilInteraction = holdFreshStart
            this._heldEpochShipsOnUnload = holdFreshStart
            this._heldBufferOverflowed = false
            this._suppressNextFreshStartHold = false
        }

        this._adoptSession(this._currentSession())
        this._restoreParkedBuffer()

        const reportStarted = (reason: SessionStartReason, payload?: Record<string, unknown>) =>
            this._reportStarted(reason, payload)
        const onTriggerActivated = (triggerType?: TriggerType) => this._onTriggerActivated(triggerType)
        this._strategy =
            config.version === 2 && config.triggerGroups?.length
                ? new V2TriggerGroupStrategy(
                      this._triggerHost,
                      this._urlTriggerMatching,
                      reportStarted,
                      (tag, payload) => this._addCustomEvent(tag, payload),
                      onTriggerActivated
                  )
                : new V1RecordingStrategy(
                      this._triggerHost,
                      this._urlTriggerMatching,
                      this._eventTriggerMatching,
                      this._linkedFlagMatching,
                      reportStarted,
                      () => this._takeFullSnapshot(),
                      onTriggerActivated
                  )
        this._strategy.onRemoteConfig(config)

        this._removeEventTriggerListener?.()
        let checkEventTriggers: ((event: CaptureResult) => void) | undefined
        this._removeEventTriggerListener = this._strategy.setupEventTriggerListeners(
            (callback) => {
                checkEventTriggers = callback
                const subscription = this._client.onEvent((info) => callback(info as unknown as CaptureResult))
                return () => subscription.dispose()
            },
            this._sessionId,
            (triggerType, matchDetail) => this._activateTrigger(triggerType, matchDetail)
        )

        this._applyPersistedOverride(SESSION_RECORDING_OVERRIDE_SAMPLING, () => this.overrideSampling())
        this._applyPersistedOverride(SESSION_RECORDING_OVERRIDE_LINKED_FLAG, () => this.overrideLinkedFlag())
        this._applyPersistedOverride(SESSION_RECORDING_OVERRIDE_EVENT_TRIGGER, () => this.overrideTrigger('event'))
        this._applyPersistedOverride(SESSION_RECORDING_OVERRIDE_URL_TRIGGER, () => this.overrideTrigger('url'))

        this._strategy.makeSamplingDecisions(this._sessionId)
        this._startRrweb()
        if (this._rrwebError) return

        this._listen()
        if (this.status === ACTIVE) {
            this._reportStarted(startReason || 'recording_initialized')
        }
        // events captured while the recorder loaded can still activate this session's event triggers
        for (const event of this._host.takeEarlyEvents()) {
            if (event.properties.$session_id === this._sessionId) {
                checkEventTriggers?.(event as unknown as CaptureResult)
            }
        }
    }

    /** Sends buffered data that is allowed to ship, then stops recording. */
    stop(): void {
        this._stopProducers()
        this._flushBuffer()
        this._buffer = this._emptyBuffer()
        this._holdFlushUntilInteraction = false
        this._heldEpochShipsOnUnload = false
        this._teardown()
    }

    /** Stops recording and drops buffered and queued data, for example after an opt-out. */
    discard(): void {
        this._holdFlushUntilInteraction = true
        this._stopProducers()
        this._buffer = this._emptyBuffer()
        this._delivery.purge()
        this._teardown()
        this._holdFlushUntilInteraction = false
        this._heldEpochShipsOnUnload = false
    }

    async flush(): Promise<void> {
        this._flushBuffer()
        await this._delivery.flush()
    }

    dispose(): void {
        if (this._disposed) return
        this.stop()
        this._disposed = true
        void this._delivery.dispose()
    }

    overrideSampling(): void {
        this._client.kv.set({ [SESSION_RECORDING_IS_SAMPLED]: this._sessionId, [SESSION_RECORDING_SAMPLE_RATE]: null })
        this._takeFullSnapshot()
        this._releaseHoldAndFlush()
        this._reportStarted('sampling_overridden')
    }

    overrideLinkedFlag(): void {
        this._linkedFlagMatching.linkedFlagSeen = true
        this._takeFullSnapshot()
        this._releaseHoldAndFlush()
        this._reportStarted('linked_flag_overridden')
    }

    overrideTrigger(triggerType: TriggerType): void {
        this._activateTrigger(triggerType)
        this._releaseHoldAndFlush()
    }

    private _applyPersistedOverride(key: string, apply: () => void): void {
        if (this._client.kv.get(key)) {
            apply()
            this._client.kv.remove(key)
        }
    }

    private _currentSession(): SessionContext | undefined {
        const session = this._client.session
        const active = this._analytics?._core._state.activeSessionId
        if (session && session.sessionId === active) return session
        return this._touchSession() ?? session
    }

    private _touchSession(timestamp?: number): SessionContext | undefined {
        const analytics = this._analytics
        if (!analytics) return undefined
        this._touchingSession = true
        try {
            return touchSession(analytics, timestamp)
        } finally {
            this._touchingSession = false
        }
    }

    private _adoptSession(session: SessionContext | undefined): void {
        if (!session) return
        this._sessionId = session.sessionId
        this._windowId = session.windowId
        this._sessionStartTimestamp = session.sessionStartTimestamp
        if (!this._buffer.data.length) this._buffer = this._emptyBuffer()
    }

    private _emptyBuffer(): BufferedSnapshot {
        return {
            size: 0,
            data: [],
            sizes: [],
            sessionId: this._sessionId,
            windowId: this._windowId,
            distinctId: this._client.distinctId,
        }
    }

    private _recordOptions(): recordOptions {
        const options = this._host.options
        const masking = this._config?.masking
        const recordOptions: recordOptions = {
            blockClass: options.blockClass ?? 'ph-no-capture',
            ignoreClass: (options.ignoreClass as string | undefined) ?? 'ph-ignore-input',
            maskTextClass: options.maskTextClass ?? 'ph-mask',
            maskInputOptions: { password: true, ...options.maskInputOptions },
            slimDOMOptions: options.slimDOMOptions ?? {},
            collectFonts: options.collectFonts ?? false,
            inlineStylesheet: options.inlineStylesheet ?? true,
            inlineStylesheetBudgetRules: 10_000,
            recordCrossOriginIframes: options.recordCrossOriginIframes ?? false,
        }
        // local masking options take precedence over the project's "Privacy and masking" settings
        recordOptions.maskAllInputs = options.maskAllInputs ?? masking?.maskAllInputs ?? true
        const maskTextSelector = options.maskTextSelector ?? masking?.maskTextSelector
        if (maskTextSelector) recordOptions.maskTextSelector = maskTextSelector
        const blockSelector = options.blockSelector ?? masking?.blockSelector
        if (blockSelector) recordOptions.blockSelector = blockSelector
        recordOptions.maskAllElementAttributes =
            options.maskAllElementAttributes ?? masking?.maskAllElementAttributes ?? false
        if (options.maskTextFn)
            recordOptions.maskTextFn = options.maskTextFn as NonNullable<recordOptions['maskTextFn']>
        if (options.maskInputFn)
            recordOptions.maskInputFn = options.maskInputFn as NonNullable<recordOptions['maskInputFn']>
        // mutually exclusive: the coarse option fails closed so a callback cannot unmask what it hides
        if (options.maskAttributeFn && !recordOptions.maskAllElementAttributes) {
            recordOptions.maskAttributeFn = options.maskAttributeFn as NonNullable<recordOptions['maskAttributeFn']>
        }
        if (options.attributeFilter) recordOptions.attributeFilter = options.attributeFilter
        if (options.sampling) {
            const sampling: NonNullable<recordOptions['sampling']> = {}
            if (options.sampling.mousemove !== undefined) sampling.mousemove = options.sampling.mousemove
            if (options.sampling.mouseInteraction !== undefined) {
                sampling.mouseInteraction = options.sampling.mouseInteraction
            }
            recordOptions.sampling = sampling
        }
        const canvas = this._config?.canvasRecording
        if (canvas?.enabled) {
            // the project's canvas setting, with posthog-js's defaults and limits
            recordOptions.recordCanvas = true
            recordOptions.sampling = { ...recordOptions.sampling, canvas: clamp(canvas.fps, 12, 4) }
            recordOptions.dataURLOptions = { type: 'image/webp', quality: clamp(canvas.quality, 1, 0.4) }
        }
        return recordOptions
    }

    private _plugins(): RecordPlugin[] {
        const plugins: RecordPlugin[] = []
        const options = this._host.options
        if (options.captureConsoleLogs ?? !!this._config?.consoleLogRecordingEnabled) {
            plugins.push(getRecordConsolePlugin() as unknown as RecordPlugin)
        }
        const remote = this._config?.networkPayloadCapture
        // a local `false` wins; otherwise structured project settings pass through, as in posthog-js
        const headers = options.recordHeaders !== false && (options.recordHeaders || remote?.recordHeaders)
        const body = options.recordBody !== false && (options.recordBody || remote?.recordBody)
        const remotePerformance = remote?.capturePerformance
        const remoteTiming =
            typeof remotePerformance === 'object' && remotePerformance !== null
                ? remotePerformance.network_timing
                : remotePerformance
        const timing = !!(options.capturePerformance ?? remoteTiming)
        if ((headers || body || timing) && !isLocalhost()) {
            // the shared builder reads posthog-js configuration names
            const networkConfig: Parameters<typeof buildNetworkRequestOptions>[0] = {
                api_host: this._analytics?._core._requestRuntime[0].api ?? '',
                session_recording: {
                    ...(options.recordHeaders !== undefined ? { recordHeaders: options.recordHeaders } : {}),
                    ...(options.recordBody !== undefined ? { recordBody: options.recordBody } : {}),
                    ...(options.maskCapturedNetworkRequestFn
                        ? { maskCapturedNetworkRequestFn: options.maskCapturedNetworkRequestFn }
                        : {}),
                },
                ...(options.capturePerformance === false ? { capture_performance: false } : {}),
            }
            plugins.push(
                getRecordNetworkPlugin(
                    buildNetworkRequestOptions(networkConfig, {
                        recordHeaders: headers,
                        recordBody: body,
                        recordPerformance: timing,
                    })
                )
            )
        }
        return plugins
    }

    private _startRrweb(): void {
        if (this._stopRrweb) return
        this._mutationThrottler ??= new MutationThrottler(recordFunction, {
            onBlockedNode: (id) =>
                this._client.logger.info(`Session recording is rate limiting mutations on node ${id}`),
            requestFullSnapshot: () => this._takeFullSnapshot(),
            resyncIntervalMs: this._fullSnapshotIntervalMs(),
        })
        const plugins = this._plugins()
        try {
            this._stopRrweb = recordFunction({
                ...this._recordOptions(),
                emit: (event) => this._onEmit(event),
                plugins,
                errorHandler: (_error, context) => context === 'rrweb',
                recordAfter: 'DOMContentLoaded',
            })
        } catch (error) {
            this._client.logger.error('Session recording could not start rrweb', error)
        }
        this._rrwebError = !this._stopRrweb
        if (this._rrwebError) return
        this._lastActivityTimestamp = Date.now()
        this._addCustomEvent('$remote_config_received', this._config)
        this._addCustomEvent('$session_options', { activePlugins: plugins.map((plugin) => plugin.name) })
    }

    private _listen(): void {
        if (this._subscriptions.length) return
        const window = globalThis.window
        const onUnload = () => this._onUnload()
        const onVisibility = () => {
            const state = globalThis.document?.visibilityState
            if (state) this._addCustomEvent(`window ${state}`, {})
        }
        // oxlint-disable-next-line posthog-js/no-add-event-listener
        window?.addEventListener('pagehide', onUnload)
        // oxlint-disable-next-line posthog-js/no-add-event-listener
        globalThis.document?.addEventListener('visibilitychange', onVisibility)
        this._subscriptions.push(
            {
                dispose: () => {
                    window?.removeEventListener('pagehide', onUnload)
                    globalThis.document?.removeEventListener('visibilitychange', onVisibility)
                },
            },
            this._client.onNewSession((session) => {
                if (this._touchingSession || session.sessionId === this._sessionId) return
                this._onSessionRotated(session)
            }),
            this._client.onEvent(({ event, properties }) => {
                if (event !== '$pageview') return
                const href = typeof properties.$current_url === 'string' ? this._maskUrl(properties.$current_url) : ''
                if (!href) return
                this._lastHref = href
                this._addCustomEvent('$pageview', { href })
            })
        )
    }

    private _teardown(): void {
        this._clearFlushTimer()
        this._mutationThrottler?.stop()
        clearInterval(this._fullSnapshotTimer)
        this._fullSnapshotTimer = undefined
        this._removeEventTriggerListener?.()
        this._removeEventTriggerListener = undefined
        this._strategy?.stop()
        for (const subscription of this._subscriptions.splice(0)) subscription.dispose()
    }

    private _stopProducers(): void {
        const stop = this._stopRrweb
        this._stopRrweb = undefined
        try {
            stop?.()
        } catch (error) {
            this._client.logger.error('Session recording could not stop rrweb', error)
        }
    }

    private _onSessionRotated(session: SessionContext): void {
        const holdNextEpoch = this._isIdle !== false
        this._addCustomEvent('$session_id_change', { sessionId: session.sessionId, windowId: session.windowId })
        // rrweb emits the marker synchronously, and processing it may already have restarted on the new session
        if (this._sessionId === session.sessionId) return
        this._isIdle = 'unknown'
        this._restartForSessionChange(holdNextEpoch)
    }

    private _restartForSessionChange(holdNextEpoch: boolean): void {
        if (this._restarting) return
        this._restarting = true
        try {
            this._lastActivityTimestamp = Date.now()
            // a held epoch is discarded by this stop: its flush is suppressed and the buffer cleared
            this.stop()
            this._strategy?.clearConditionalRecordingPersistence()
            if (this._client.canCapture) this.start('session_id_changed')
        } finally {
            this._restarting = false
        }
        this._holdFlushUntilInteraction = holdNextEpoch
        this._heldEpochShipsOnUnload = false
    }

    private _releaseHoldAndFlush(): void {
        if (!this.isStarted) this._suppressNextFreshStartHold = true
        if (!this._holdFlushUntilInteraction) return
        this._holdFlushUntilInteraction = false
        this._heldEpochShipsOnUnload = false
        if (this._heldBufferOverflowed) {
            this._heldBufferOverflowed = false
            this._takeFullSnapshot()
        }
        this._scheduleFlush()
    }

    private _onUnload(): void {
        if (this.status === BUFFERING) {
            // a recording still waiting for a trigger is not sent; earlier flushed snapshots still are
            this._buffer = this._emptyBuffer()
            this._delivery.teardown()
            return
        }
        // a passive visit that started held still ships on a clean unload within its session's maximum length;
        // a rotation-born hold does not
        if (
            this._holdFlushUntilInteraction &&
            this._heldEpochShipsOnUnload &&
            this._host.documentWasEverVisible() &&
            Date.now() - this._sessionStartTimestamp <= MAX_SESSION_LENGTH
        ) {
            this._holdFlushUntilInteraction = false
        }
        this._flushBuffer(true)
        this._delivery.teardown()
    }

    private _reportStarted(reason: SessionStartReason, payload?: Record<string, unknown>): void {
        this._client.registerForSession({ [SESSION_RECORDING_START_REASON]: reason })
        if (reason !== 'session_id_changed') this._addCustomEvent('$recording_started', { reason, ...payload })
    }

    private _activateTrigger(triggerType: TriggerType, matchDetail?: string): void {
        // event triggers show someone cares about the session; URL triggers only scope where to record
        if (triggerType === 'event') this._releaseHoldAndFlush()
        if (this._activatingTrigger || !this._strategy?.hasPendingTriggers(this._sessionId)) return
        this._activatingTrigger = true
        try {
            this._client.kv.set(
                triggerType === 'url'
                    ? SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION
                    : SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION,
                this._sessionId
            )
            this._strategy.updateActiveTriggers(this._sessionId)
            this._onTriggerActivated()
            this._flushBuffer()
            this._reportStarted(`${triggerType}_trigger_matched` as SessionStartReason, {
                [triggerType === 'url' ? 'matchedUrl' : 'matchedEvent']: matchDetail,
            })
        } finally {
            this._activatingTrigger = false
        }
    }

    private _onTriggerActivated(triggerType?: TriggerType): void {
        if (triggerType === 'event') this._releaseHoldAndFlush()
        if (this._urlTriggerMatching.urlBlocked || ![SAMPLED, ACTIVE].includes(this.status)) return
        this._scheduleFullSnapshot()
    }

    private _pause(): void {
        if (this._urlTriggerMatching.urlBlocked) return
        this._urlTriggerMatching.urlBlocked = true
        clearInterval(this._fullSnapshotTimer)
        this._addCustomEvent('recording paused', { reason: 'url blocker' })
    }

    private _resume(): void {
        if (!this._urlTriggerMatching.urlBlocked) return
        this._urlTriggerMatching.urlBlocked = false
        this._takeFullSnapshot()
        this._scheduleFullSnapshot()
        this._addCustomEvent('recording resumed', { reason: 'left blocked url' })
    }

    private _fullSnapshotIntervalMs(): number {
        if (this._strategy?.hasPendingTriggers(this._sessionId) && ![SAMPLED, ACTIVE].includes(this.status)) {
            return ONE_MINUTE
        }
        return this._host.options.fullSnapshotIntervalMs ?? FIVE_MINUTES
    }

    private _scheduleFullSnapshot(): void {
        clearInterval(this._fullSnapshotTimer)
        this._fullSnapshotTimer = undefined
        const interval = this._fullSnapshotIntervalMs()
        if (this._isIdle === true || !interval) return
        this._fullSnapshotTimer = setInterval(() => this._takeFullSnapshot(), interval)
    }

    private _takeFullSnapshot(): void {
        if (!this._stopRrweb) return
        try {
            recordFunction.takeFullSnapshot()
        } catch (error) {
            this._client.logger.warn('Session recording could not take a full snapshot', error)
        }
    }

    private _addCustomEvent(tag: string, payload: unknown): void {
        if (!this._stopRrweb) return
        try {
            recordFunction.addCustomEvent(tag, payload)
        } catch (error) {
            this._client.logger.warn('Session recording could not add a custom event', error)
        }
    }

    private _maskUrl(rawUrl: string): string | undefined {
        // fragments often hold tokens (for example OAuth redirects); posthog-js strips them from replay URLs by default
        const hashIndex = rawUrl.indexOf('#')
        const url = hashIndex < 0 ? rawUrl : rawUrl.slice(0, hashIndex)
        const mask = this._host.options.maskCapturedNetworkRequestFn
        if (!mask) return url
        try {
            // page URLs are masked with the network request callback, which reads only `name` here
            // oxlint-disable-next-line typescript/consistent-type-assertions
            return mask({ name: url } as Parameters<typeof mask>[0])?.name
        } catch {
            return undefined
        }
    }

    private _onEmit(rawEvent: eventWithTime): void {
        try {
            this._processEvent(rawEvent)
        } catch (error) {
            this._client.logger.error('Session recording could not process an event', error)
        }
    }

    private _processEvent(rawEvent: eventWithTime): void {
        if (!rawEvent || typeof rawEvent !== 'object' || this._disposed) return

        if (rawEvent.type === EventType.Meta) {
            const href = this._maskUrl(rawEvent.data.href)
            this._lastHref = href
            if (!href) return
            rawEvent.data.href = href
        } else {
            this._trackUrlChange()
        }

        this._strategy?.checkUrlTriggers(
            this._sessionId,
            () => this._pause(),
            () => this._resume(),
            (triggerType, matchDetail) => this._activateTrigger(triggerType, matchDetail)
        )
        if (this._urlTriggerMatching.urlBlocked && !isCustomEvent(rawEvent, 'recording paused')) return

        if (rawEvent.type === EventType.FullSnapshot) {
            this._scheduleFullSnapshot()
            this._mutationThrottler?.reset()
            // while waiting for a trigger, keep only the most recent full snapshot and what follows it
            if (this._strategy?.hasPendingTriggers(this._sessionId)) this._clearBufferBeforeMostRecentMeta()
        }

        const throttled = this._mutationThrottler ? this._mutationThrottler.throttleMutations(rawEvent) : rawEvent
        if (!throttled) return
        const event = truncateLargeConsoleLogs(throttled)

        const idlePayload = isCustomEvent(event, 'sessionIdle')
            ? ((event.data as { payload?: { lastActivityTimestamp: number; threshold: number } }).payload ?? null)
            : null
        // the restart records the new session from a fresh full snapshot; this event belongs to the old recorder
        if (!idlePayload && this._updateSessionAndIdle(event)) return

        if (this._isIdle === true && !idlePayload) return
        if (idlePayload) {
            // stamp the marker when the session actually went idle, not when rrweb saw it
            event.timestamp = idlePayload.lastActivityTimestamp + idlePayload.threshold
        }

        // compresses full snapshots, mutations and style rules in place, as posthog-js does by default
        const { event: compressed, size } = compressEventSync(event)
        if (size === UNSTRINGIFIABLE_EVENT_SIZE) {
            this._client.logger.warn('Session recording dropped an event that could not be serialized')
            return
        }
        if (this.status === DISABLED) {
            this._buffer = this._emptyBuffer()
            return
        }
        if (event.type === EventType.FullSnapshot) this._lastFullSnapshotSessionId = this._sessionId
        this._addToBuffer(compressed as eventWithTime, size)
    }

    private _trackUrlChange(): void {
        try {
            const location = globalThis.window?.location
            if (!location) return
            const href = this._maskUrl(location.origin + location.pathname + location.search)
            if (href && href !== this._lastHref) {
                this._lastHref = href
                this._addCustomEvent('$url_changed', { href })
            }
        } catch {
            // URL processing failures do not interrupt recording.
        }
    }

    /** Tracks idleness and session changes. Returns true when the session changed and recording restarted. */
    private _updateSessionAndIdle(event: eventWithTime): boolean {
        const isUserInteraction =
            event.type === EventType.IncrementalSnapshot &&
            USER_INTERACTION_SOURCES.includes((event.data as { source: number }).source)
        const idleThreshold = this._host.options.sessionIdleThresholdMs ?? FIVE_MINUTES

        if (!isUserInteraction && this._isIdle !== true) {
            if (event.timestamp - this._lastActivityTimestamp > idleThreshold) {
                this._isIdle = true
                clearInterval(this._fullSnapshotTimer)
                this._addCustomEvent('sessionIdle', {
                    eventTimestamp: event.timestamp,
                    lastActivityTimestamp: this._lastActivityTimestamp,
                    threshold: idleThreshold,
                    bufferLength: this._buffer.data.length,
                    bufferSize: this._buffer.size,
                })
                this._flushBuffer()
            }
        }

        // only user interaction extends the session; background DOM updates must not keep it alive
        const touch =
            isUserInteraction &&
            (this._isIdle !== false || event.timestamp - this._lastTouchTimestamp >= SESSION_TOUCH_INTERVAL_MS)
        if (touch) this._lastTouchTimestamp = event.timestamp
        // after reset there is no session until something starts one, as posthog-js starts it on the next replay event
        const session =
            (touch ? this._touchSession(event.timestamp) : this._client.session) ?? this._touchSession(event.timestamp)
        let returningFromIdle = false
        if (isUserInteraction) {
            this._lastActivityTimestamp = event.timestamp
            if (this._isIdle === true) {
                this._addCustomEvent('sessionNoLongerIdle', { reason: 'user activity', type: event.type })
                returningFromIdle = true
            }
            this._isIdle = false
        }

        if (session && session.sessionId !== this._sessionId) {
            const holdNextEpoch = this._isIdle !== false
            if (holdNextEpoch) this._isIdle = 'unknown'
            this._restartForSessionChange(holdNextEpoch)
            return true
        }
        if (session) this._windowId = session.windowId
        if (isUserInteraction) this._releaseHoldAndFlush()
        if (returningFromIdle) {
            // changes dropped while idle left the player's copy of the page stale
            this._takeFullSnapshot()
            this._scheduleFullSnapshot()
        }
        return false
    }

    private _addToBuffer(event: eventWithTime, size: number): void {
        const additionalBytes = 2 + this._buffer.data.length
        const sessionChanged = this._buffer.sessionId !== this._sessionId
        const distinctIdChanged = this._buffer.distinctId !== this._client.distinctId
        if (
            sessionChanged ||
            distinctIdChanged ||
            (this._isIdle !== true &&
                !this._holdFlushUntilInteraction &&
                this._buffer.size + size + additionalBytes > MAX_SNAPSHOT_BYTES)
        ) {
            this._flushBuffer()
            // a suppressed flush keeps the buffer. Another session's data is dropped, but data held when
            // the person changes (identify) stays, with its full snapshot, under the new person as in posthog-js
            if (sessionChanged && this._buffer.data.length) this._buffer = this._emptyBuffer()
            this._buffer.sessionId = this._sessionId
            this._buffer.windowId = this._windowId
            this._buffer.distinctId = this._client.distinctId
        }

        // a held buffer cannot ship at the cap, so stop collecting but keep the epoch's start
        if (
            this._holdFlushUntilInteraction &&
            (this._heldBufferOverflowed || this._buffer.size + size + additionalBytes > MAX_SNAPSHOT_BYTES)
        ) {
            this._heldBufferOverflowed = true
            return
        }

        this._buffer.size += size
        this._buffer.data.push(event)
        this._buffer.sizes.push(size)
        if (this._isIdle !== true && !this._holdFlushUntilInteraction) this._scheduleFlush()
    }

    private _clearBufferBeforeMostRecentMeta(): void {
        const data = this._buffer.data
        let index = data.length - 1
        while (index >= 0 && data[index].type !== EventType.Meta) index--
        if (index < 0) {
            this._buffer = this._emptyBuffer()
            return
        }
        this._buffer.data = data.slice(index)
        this._buffer.sizes = this._buffer.sizes.slice(index)
        this._buffer.size = this._buffer.sizes.reduce((total, size) => total + size, 0)
    }

    private _scheduleFlush(): void {
        if (this._flushTimer === undefined) {
            this._flushTimer = setTimeout(() => {
                this._flushTimer = undefined
                this._flushBuffer()
            }, FLUSH_DELAY_MS)
        }
    }

    private _clearFlushTimer(): void {
        if (this._flushTimer !== undefined) {
            clearTimeout(this._flushTimer)
            this._flushTimer = undefined
        }
    }

    private _isBelowMinimumDuration(): boolean {
        const minimumDuration = this._strategy?.getMinimumDuration(this._sessionId)
        if (typeof minimumDuration !== 'number') return false
        const last = this._buffer.data[this._buffer.data.length - 1] as eventWithTime | undefined
        const duration = last ? last.timestamp - this._sessionStartTimestamp : null
        return duration !== null && duration >= 0 && duration < minimumDuration
    }

    private _flushBuffer(unloading = false): void {
        this._clearFlushTimer()
        if (this._holdFlushUntilInteraction || this._buffer.data.length === 0) return
        this._strategy?.ensureSamplingDecision(this._sessionId)
        const status = this.status
        if (status === BUFFERING || status === PAUSED || status === DISABLED || this._isBelowMinimumDuration()) {
            // a recording held only by the minimum duration continues from the next page in this tab
            if (unloading && (status === ACTIVE || status === SAMPLED)) this._parkBuffer()
            this._scheduleFlush()
            return
        }
        // a recording must not open with lifecycle markers alone, which play back as nothing
        if (
            this._lastFullSnapshotSessionId !== this._buffer.sessionId &&
            this._buffer.data.every((event: eventWithTime) => event.type === EventType.Custom)
        ) {
            if (this._buffer.size > MAX_SNAPSHOT_BYTES) this._buffer = this._emptyBuffer()
            return
        }

        const buffer = this._buffer
        this._buffer = this._emptyBuffer()
        const host = this._currentMaskedHostname()
        for (const chunk of splitBuffer(buffer)) {
            this._delivery.enqueue(
                {
                    uuid: createId(),
                    event: '$snapshot',
                    timestamp: new Date().toISOString(),
                    properties: {
                        $snapshot_bytes: chunk.size,
                        $snapshot_data: chunk.data,
                        $session_id: chunk.sessionId,
                        $window_id: chunk.windowId,
                        $lib: 'web',
                        $lib_version: version,
                        ...(host ? { $snapshot_host: host } : {}),
                        distinct_id: buffer.distinctId,
                        token: this._client.projectToken,
                    },
                },
                chunk.size
            )
        }
        if (this._parkedBufferSize !== undefined) {
            this._parkingStore()?.remove(PARKED_BUFFER_KEY)
            this._parkedBufferSize = undefined
        }
        this._strategy?.onFlushComplete()
    }

    private _parkingStore(): KeyValueStore | undefined {
        try {
            this._parking ??= (this._client as unknown as ParkingAccess)._state.tabKeyValueStore(
                'replay',
                () => this._client.canCapture
            )
        } catch {
            // Without tab storage the buffer ends with the page.
        }
        return this._parking
    }

    private _parkBuffer(): void {
        const buffer = this._buffer
        if (!buffer.data.length || buffer.size > MAX_SNAPSHOT_BYTES || buffer.size === this._parkedBufferSize) return
        try {
            this._parkingStore()?.set(PARKED_BUFFER_KEY, buffer)
            this._parkedBufferSize = buffer.size
        } catch {
            // A buffer that cannot be parked ends with the page.
        }
    }

    private _restoreParkedBuffer(): void {
        if (this._parkedBufferRestored) return
        this._parkedBufferRestored = true
        const store = this._parkingStore()
        const parked = store?.get<Partial<BufferedSnapshot>>(PARKED_BUFFER_KEY)
        store?.remove(PARKED_BUFFER_KEY)
        if (
            !parked ||
            !Array.isArray(parked.data) ||
            !parked.data.length ||
            !Array.isArray(parked.sizes) ||
            parked.sizes.length !== parked.data.length ||
            !Number.isFinite(parked.size) ||
            // only the same session in the same tab: a rotation or a duplicated tab must not replay another epoch
            parked.sessionId !== this._sessionId ||
            parked.windowId !== this._windowId ||
            this._buffer.data.length
        ) {
            return
        }
        this._buffer = {
            size: parked.size!,
            data: parked.data,
            sizes: parked.sizes,
            sessionId: this._sessionId,
            windowId: this._windowId,
            distinctId: typeof parked.distinctId === 'string' ? parked.distinctId : this._client.distinctId,
        }
        this._lastFullSnapshotSessionId = this._sessionId
    }

    private _currentMaskedHostname(): string | undefined {
        try {
            const href = globalThis.window?.location?.href
            const masked = href ? this._maskUrl(href) : undefined
            return masked ? new URL(masked).hostname || undefined : undefined
        } catch {
            return undefined
        }
    }
}

export const createSessionRecorder = (host: RecorderHost): SessionRecorder => new SessionRecorder(host)
