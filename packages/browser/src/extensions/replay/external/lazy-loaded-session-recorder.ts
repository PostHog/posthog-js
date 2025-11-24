import type { recordOptions, rrwebRecord as rrwebRecordType } from '../types/rrweb'
import {
    type customEvent,
    EventType,
    eventWithTime,
    IncrementalSource,
    type listenerHandler,
    RecordPlugin,
} from '../types/rrweb-types'
import { buildNetworkRequestOptions } from './config'
import {
    ACTIVE,
    allMatchSessionRecordingStatus,
    AndTriggerMatching,
    anyMatchSessionRecordingStatus,
    BUFFERING,
    DISABLED,
    EventTriggerMatching,
    LinkedFlagMatching,
    nullMatchSessionRecordingStatus,
    OrTriggerMatching,
    PAUSED,
    PendingTriggerMatching,
    RecordingTriggersStatus,
    SAMPLED,
    SessionRecordingStatus,
    TRIGGER_PENDING,
    TriggerStatusMatching,
    TriggerType,
    URLTriggerMatching,
} from './triggerMatching'
import { estimateSize, INCREMENTAL_SNAPSHOT_EVENT_TYPE, truncateLargeConsoleLogs } from './sessionrecording-utils'
import { gzipSync, strFromU8, strToU8 } from 'fflate'
import { assignableWindow, LazyLoadedSessionRecordingInterface, window, document } from '../../../utils/globals'
import { addEventListener } from '../../../utils'
import { MutationThrottler } from './mutation-throttler'
import { createLogger } from '../../../utils/logger'
import {
    clampToRange,
    includes,
    isBoolean,
    isFunction,
    isNull,
    isNullish,
    isNumber,
    isObject,
    isString,
    isUndefined,
} from '@posthog/core'
import {
    SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION,
    SESSION_RECORDING_IS_SAMPLED,
    SESSION_RECORDING_OVERRIDE_SAMPLING,
    SESSION_RECORDING_OVERRIDE_LINKED_FLAG,
    SESSION_RECORDING_OVERRIDE_EVENT_TRIGGER,
    SESSION_RECORDING_OVERRIDE_URL_TRIGGER,
    SESSION_RECORDING_PAST_MINIMUM_DURATION,
    SESSION_RECORDING_REMOTE_CONFIG,
    SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION,
} from '../../../constants'
import { PostHog } from '../../../posthog-core'
import {
    CaptureResult,
    NetworkRecordOptions,
    NetworkRequest,
    Properties,
    SessionIdChangedCallback,
    SessionRecordingOptions,
    SessionRecordingPersistedConfig,
    SessionStartReason,
} from '../../../types'
import { isLocalhost } from '../../../utils/request-utils'
import Config from '../../../config'
import { sampleOnProperty } from '../../sampling'
import { FlushedSizeTracker } from './flushed-size-tracker'

const BASE_ENDPOINT = '/s/'
const DEFAULT_CANVAS_QUALITY = 0.4
const DEFAULT_CANVAS_FPS = 4
const MAX_CANVAS_FPS = 12
const MAX_CANVAS_QUALITY = 1
const TWO_SECONDS = 2000
const ONE_KB = 1024

const ONE_MINUTE = 1000 * 60
const FIVE_MINUTES = ONE_MINUTE * 5

export const RECORDING_IDLE_THRESHOLD_MS = FIVE_MINUTES
export const RECORDING_MAX_EVENT_SIZE = ONE_KB * ONE_KB * 0.9 // ~1mb (with some wiggle room)
export const RECORDING_BUFFER_TIMEOUT = 2000 // 2 seconds
export const SESSION_RECORDING_BATCH_KEY = 'recordings'

const LOGGER_PREFIX = '[SessionRecording]'
const logger = createLogger(LOGGER_PREFIX)

interface QueuedRRWebEvent {
    rrwebMethod: () => void
    attempt: number
    // the timestamp this was first put into this queue
    enqueuedAt: number
}

interface SessionIdlePayload {
    eventTimestamp: number
    lastActivityTimestamp: number
    threshold: number
    bufferLength: number
    bufferSize: number
}

export interface SnapshotBuffer {
    size: number
    data: any[]
    sessionId: string
    windowId: string
}

const ACTIVE_SOURCES = [
    IncrementalSource.MouseMove,
    IncrementalSource.MouseInteraction,
    IncrementalSource.Scroll,
    IncrementalSource.ViewportResize,
    IncrementalSource.Input,
    IncrementalSource.TouchMove,
    IncrementalSource.MediaInteraction,
    IncrementalSource.Drag,
]

const newQueuedEvent = (rrwebMethod: () => void): QueuedRRWebEvent => ({
    rrwebMethod,
    enqueuedAt: Date.now(),
    attempt: 1,
})

function getRRWebRecord(): rrwebRecordType | undefined {
    return assignableWindow?.__PosthogExtensions__?.rrweb?.record
}

export type compressedFullSnapshotEvent = {
    type: EventType.FullSnapshot
    data: string
}

export type compressedIncrementalSnapshotEvent = {
    type: EventType.IncrementalSnapshot
    data: {
        source: IncrementalSource
        texts: string
        attributes: string
        removes: string
        adds: string
    }
}

export type compressedIncrementalStyleSnapshotEvent = {
    type: EventType.IncrementalSnapshot
    data: {
        source: IncrementalSource.StyleSheetRule
        id?: number
        styleId?: number
        replace?: string
        replaceSync?: string
        adds?: string
        removes?: string
    }
}

export type compressedEvent =
    | compressedIncrementalStyleSnapshotEvent
    | compressedFullSnapshotEvent
    | compressedIncrementalSnapshotEvent
export type compressedEventWithTime = compressedEvent & {
    timestamp: number
    delay?: number
    // marker for compression version
    cv: '2024-10'
}

function gzipToString(data: unknown): string {
    return strFromU8(gzipSync(strToU8(JSON.stringify(data))), true)
}

/**
 * rrweb's packer takes an event and returns a string or the reverse on `unpack`.
 * but we want to be able to inspect metadata during ingestion.
 * and don't want to compress the entire event,
 * so we have a custom packer that only compresses part of some events
 */
function compressEvent(event: eventWithTime): eventWithTime | compressedEventWithTime {
    try {
        if (event.type === EventType.FullSnapshot) {
            return {
                ...event,
                data: gzipToString(event.data),
                cv: '2024-10',
            }
        }
        if (event.type === EventType.IncrementalSnapshot && event.data.source === IncrementalSource.Mutation) {
            return {
                ...event,
                cv: '2024-10',
                data: {
                    ...event.data,
                    texts: gzipToString(event.data.texts),
                    attributes: gzipToString(event.data.attributes),
                    removes: gzipToString(event.data.removes),
                    adds: gzipToString(event.data.adds),
                },
            }
        }
        if (event.type === EventType.IncrementalSnapshot && event.data.source === IncrementalSource.StyleSheetRule) {
            return {
                ...event,
                cv: '2024-10',
                data: {
                    ...event.data,
                    adds: event.data.adds ? gzipToString(event.data.adds) : undefined,
                    removes: event.data.removes ? gzipToString(event.data.removes) : undefined,
                },
            }
        }
    } catch (e) {
        logger.error('could not compress event - will use uncompressed event', e)
    }
    return event
}

function isCustomEvent(e: eventWithTime, tag: string): e is eventWithTime & customEvent {
    return e.type === EventType.Custom && e.data.tag === tag
}

function isSessionIdleEvent(e: eventWithTime): e is eventWithTime & customEvent {
    return isCustomEvent(e, 'sessionIdle')
}

function isSessionEndingEvent(e: eventWithTime): e is eventWithTime & customEvent {
    return isCustomEvent(e, '$session_ending')
}

function isSessionStartingEvent(e: eventWithTime): e is eventWithTime & customEvent {
    return isCustomEvent(e, '$session_starting')
}

function isAllowedWhenIdle(e: eventWithTime): boolean {
    return isSessionIdleEvent(e) || isSessionEndingEvent(e) || isSessionStartingEvent(e)
}

/** When we put the recording into a paused state, we add a custom event.
 *  However, in the paused state, events are dropped and never make it to the buffer,
 *  so we need to manually let this one through */
function isRecordingPausedEvent(e: eventWithTime) {
    return e.type === EventType.Custom && e.data.tag === 'recording paused'
}

export const SEVEN_MEGABYTES = 1024 * 1024 * 7 * 0.9 // ~7mb (with some wiggle room)

// recursively splits large buffers into smaller ones
// uses a pretty high size limit to avoid splitting too much
export function splitBuffer(buffer: SnapshotBuffer, sizeLimit: number = SEVEN_MEGABYTES): SnapshotBuffer[] {
    if (buffer.size >= sizeLimit && buffer.data.length > 1) {
        const half = Math.floor(buffer.data.length / 2)
        const firstHalf = buffer.data.slice(0, half)
        const secondHalf = buffer.data.slice(half)
        return [
            splitBuffer({
                size: estimateSize(firstHalf),
                data: firstHalf,
                sessionId: buffer.sessionId,
                windowId: buffer.windowId,
            }),
            splitBuffer({
                size: estimateSize(secondHalf),
                data: secondHalf,
                sessionId: buffer.sessionId,
                windowId: buffer.windowId,
            }),
        ].flatMap((x) => x)
    } else {
        return [buffer]
    }
}

export class LazyLoadedSessionRecording implements LazyLoadedSessionRecordingInterface {
    private _endpoint: string = BASE_ENDPOINT
    private _mutationThrottler?: MutationThrottler
    /**
     * Util to help developers working on this feature manually override
     */
    private _forceAllowLocalhostNetworkCapture = false
    private _stopRrweb: listenerHandler | undefined = undefined
    private _lastActivityTimestamp: number = Date.now()
    /**
     * if pageview capture is disabled,
     * then we can manually track href changes
     */
    private _lastHref?: string
    /**
     * and a queue - that contains rrweb events that we want to send to rrweb, but rrweb wasn't able to accept them yet
     */
    private _queuedRRWebEvents: QueuedRRWebEvent[] = []
    private _isIdle: boolean | 'unknown' = 'unknown'

    private _linkedFlagMatching: LinkedFlagMatching
    private _urlTriggerMatching: URLTriggerMatching
    private _eventTriggerMatching: EventTriggerMatching
    // we need to be able to check the state of the event and url triggers separately
    // as we make some decisions based on them without referencing LinkedFlag etc
    private _triggerMatching: TriggerStatusMatching = new PendingTriggerMatching()
    private _fullSnapshotTimer?: ReturnType<typeof setInterval>

    private _windowId: string
    private _sessionId: string
    get sessionId(): string {
        return this._sessionId
    }

    private _flushBufferTimer?: any
    // we have a buffer - that contains PostHog snapshot events ready to be sent to the server
    private _buffer: SnapshotBuffer

    private _removePageViewCaptureHook: (() => void) | undefined = undefined

    private _removeEventTriggerCaptureHook: (() => void) | undefined = undefined

    private _flushedSizeTracker: FlushedSizeTracker

    private get _sessionManager() {
        if (!this._instance.sessionManager) {
            throw new Error(LOGGER_PREFIX + ' must be started with a valid sessionManager.')
        }

        return this._instance.sessionManager
    }

    private get _sessionIdleThresholdMilliseconds(): number {
        return this._instance.config.session_recording.session_idle_threshold_ms || RECORDING_IDLE_THRESHOLD_MS
    }

    private get _isSampled(): boolean | null {
        const currentValue = this._instance.get_property(SESSION_RECORDING_IS_SAMPLED)
        // originally we would store `true` or `false` or nothing,
        // but that would mean sometimes we would carry on recording on session id change
        return isBoolean(currentValue) ? currentValue : isString(currentValue) ? currentValue === this.sessionId : null
    }

    private get _sampleRate(): number | null {
        const rate = this._remoteConfig?.sampleRate
        return isNumber(rate) ? rate : null
    }

    private get _minimumDuration(): number | null {
        const duration = this._remoteConfig?.minimumDurationMilliseconds
        return isNumber(duration) ? duration : null
    }

    private _statusMatcher: (triggersStatus: RecordingTriggersStatus) => SessionRecordingStatus =
        nullMatchSessionRecordingStatus

    private _onSessionIdListener: (() => void) | undefined = undefined
    private _onSessionIdleResetForcedListener: (() => void) | undefined = undefined
    private _samplingSessionListener: (() => void) | undefined = undefined
    private _forceIdleSessionIdListener: (() => void) | undefined = undefined

    constructor(private readonly _instance: PostHog) {
        // we know there's a sessionManager, so don't need to start without a session id
        const { sessionId, windowId } = this._sessionManager.checkAndGetSessionAndWindowId()
        this._sessionId = sessionId
        this._windowId = windowId

        this._linkedFlagMatching = new LinkedFlagMatching(this._instance)
        this._urlTriggerMatching = new URLTriggerMatching(this._instance)
        this._eventTriggerMatching = new EventTriggerMatching(this._instance)

        this._buffer = this._clearBuffer()

        if (this._sessionIdleThresholdMilliseconds >= this._sessionManager.sessionTimeoutMs) {
            logger.warn(
                `session_idle_threshold_ms (${this._sessionIdleThresholdMilliseconds}) is greater than the session timeout (${this._sessionManager.sessionTimeoutMs}). Session will never be detected as idle`
            )
        }

        this._flushedSizeTracker = new FlushedSizeTracker(this._instance)
    }

    private get _masking():
        | Pick<SessionRecordingOptions, 'maskAllInputs' | 'maskTextSelector' | 'blockSelector'>
        | undefined {
        const masking_server_side = this._remoteConfig?.masking
        const masking_client_side = {
            maskAllInputs: this._instance.config.session_recording?.maskAllInputs,
            maskTextSelector: this._instance.config.session_recording?.maskTextSelector,
            blockSelector: this._instance.config.session_recording?.blockSelector,
        }

        const maskAllInputs = masking_client_side?.maskAllInputs ?? masking_server_side?.maskAllInputs
        const maskTextSelector = masking_client_side?.maskTextSelector ?? masking_server_side?.maskTextSelector
        const blockSelector = masking_client_side?.blockSelector ?? masking_server_side?.blockSelector

        return !isUndefined(maskAllInputs) || !isUndefined(maskTextSelector) || !isUndefined(blockSelector)
            ? {
                  maskAllInputs: maskAllInputs ?? true,
                  maskTextSelector,
                  blockSelector,
              }
            : undefined
    }

    private get _canvasRecording(): { enabled: boolean; fps: number; quality: number } {
        const canvasRecording_client_side = this._instance.config.session_recording.captureCanvas
        const canvasRecording_server_side = this._remoteConfig?.canvasRecording

        const enabled: boolean =
            canvasRecording_client_side?.recordCanvas ?? canvasRecording_server_side?.enabled ?? false
        const fps: number =
            canvasRecording_client_side?.canvasFps ?? canvasRecording_server_side?.fps ?? DEFAULT_CANVAS_FPS
        let quality: string | number =
            canvasRecording_client_side?.canvasQuality ?? canvasRecording_server_side?.quality ?? DEFAULT_CANVAS_QUALITY
        if (typeof quality === 'string') {
            const parsed = parseFloat(quality)
            quality = isNaN(parsed) ? 0.4 : parsed
        }

        return {
            enabled,
            fps: clampToRange(fps, 0, MAX_CANVAS_FPS, createLogger('canvas recording fps'), DEFAULT_CANVAS_FPS),
            quality: clampToRange(
                quality,
                0,
                MAX_CANVAS_QUALITY,
                createLogger('canvas recording quality'),
                DEFAULT_CANVAS_QUALITY
            ),
        }
    }

    private get _isConsoleLogCaptureEnabled() {
        const enabled_server_side = !!this._remoteConfig?.consoleLogRecordingEnabled
        const enabled_client_side = this._instance.config.enable_recording_console_log
        return enabled_client_side ?? enabled_server_side
    }

    // network payload capture config has three parts
    // each can be configured server side or client side
    private get _networkPayloadCapture():
        | Pick<NetworkRecordOptions, 'recordHeaders' | 'recordBody' | 'recordPerformance'>
        | undefined {
        const networkPayloadCapture_server_side = this._remoteConfig?.networkPayloadCapture
        const networkPayloadCapture_client_side = {
            recordHeaders: this._instance.config.session_recording?.recordHeaders,
            recordBody: this._instance.config.session_recording?.recordBody,
        }
        const headersEnabled =
            networkPayloadCapture_client_side?.recordHeaders || networkPayloadCapture_server_side?.recordHeaders
        const bodyEnabled =
            networkPayloadCapture_client_side?.recordBody || networkPayloadCapture_server_side?.recordBody
        const clientConfigForPerformanceCapture = isObject(this._instance.config.capture_performance)
            ? this._instance.config.capture_performance.network_timing
            : this._instance.config.capture_performance
        const networkTimingEnabled = !!(isBoolean(clientConfigForPerformanceCapture)
            ? clientConfigForPerformanceCapture
            : networkPayloadCapture_server_side?.capturePerformance)

        return headersEnabled || bodyEnabled || networkTimingEnabled
            ? { recordHeaders: headersEnabled, recordBody: bodyEnabled, recordPerformance: networkTimingEnabled }
            : undefined
    }

    private _gatherRRWebPlugins() {
        const plugins: RecordPlugin[] = []

        const recordConsolePlugin = assignableWindow.__PosthogExtensions__?.rrwebPlugins?.getRecordConsolePlugin
        if (recordConsolePlugin && this._isConsoleLogCaptureEnabled) {
            plugins.push(recordConsolePlugin())
        }

        const networkPlugin = assignableWindow.__PosthogExtensions__?.rrwebPlugins?.getRecordNetworkPlugin
        if (!!this._networkPayloadCapture && isFunction(networkPlugin)) {
            const canRecordNetwork = !isLocalhost() || this._forceAllowLocalhostNetworkCapture

            if (canRecordNetwork) {
                plugins.push(
                    networkPlugin(buildNetworkRequestOptions(this._instance.config, this._networkPayloadCapture))
                )
            } else {
                logger.info('NetworkCapture not started because we are on localhost.')
            }
        }

        return plugins
    }

    private _maskUrl(url: string): string | undefined {
        const userSessionRecordingOptions = this._instance.config.session_recording

        if (userSessionRecordingOptions.maskNetworkRequestFn) {
            let networkRequest: NetworkRequest | null | undefined = {
                url,
            }

            // TODO we should deprecate this and use the same function for this masking and the rrweb/network plugin
            // TODO or deprecate this and provide a new clearer name so this would be `maskURLPerformanceFn` or similar
            networkRequest = userSessionRecordingOptions.maskNetworkRequestFn(networkRequest)

            return networkRequest?.url
        }

        return url
    }

    private _tryRRWebMethod(queuedRRWebEvent: QueuedRRWebEvent): boolean {
        try {
            queuedRRWebEvent.rrwebMethod()
            return true
        } catch (e) {
            // Sometimes a race can occur where the recorder is not fully started yet
            if (this._queuedRRWebEvents.length < 10) {
                this._queuedRRWebEvents.push({
                    enqueuedAt: queuedRRWebEvent.enqueuedAt || Date.now(),
                    attempt: queuedRRWebEvent.attempt + 1,
                    rrwebMethod: queuedRRWebEvent.rrwebMethod,
                })
            } else {
                logger.warn('could not emit queued rrweb event.', e, queuedRRWebEvent)
            }

            return false
        }
    }

    private _tryAddCustomEvent(tag: string, payload: any): boolean {
        return this._tryRRWebMethod(newQueuedEvent(() => getRRWebRecord()!.addCustomEvent(tag, payload)))
    }

    private _pageViewFallBack() {
        try {
            if (this._instance.config.capture_pageview || !window) {
                return
            }
            // Strip hash parameters from URL since they often aren't helpful
            // Use URL constructor for proper parsing to handle edge cases
            // recording doesn't run in IE11, so we don't need compat here
            // eslint-disable-next-line compat/compat
            const url = new URL(window.location.href)
            const hrefWithoutHash = url.origin + url.pathname + url.search
            const currentUrl = this._maskUrl(hrefWithoutHash)
            if (this._lastHref !== currentUrl) {
                this._lastHref = currentUrl
                this._tryAddCustomEvent('$url_changed', { href: currentUrl })
            }
        } catch {
            // If URL processing fails, don't capture anything
        }
    }

    private _processQueuedEvents() {
        if (this._queuedRRWebEvents.length) {
            // if rrweb isn't ready to accept events earlier, then we queued them up.
            // now that `emit` has been called rrweb should be ready to accept them.
            // so, before we process this event, we try our queued events _once_ each
            // we don't want to risk queuing more things and never exiting this loop!
            // if they fail here, they'll be pushed into a new queue
            // and tried on the next loop.
            // there is a risk of this queue growing in an uncontrolled manner.
            // so its length is limited elsewhere
            // for now this is to help us ensure we can capture events that happen
            // and try to identify more about when it is failing
            const itemsToProcess = [...this._queuedRRWebEvents]
            this._queuedRRWebEvents = []
            itemsToProcess.forEach((queuedRRWebEvent) => {
                if (Date.now() - queuedRRWebEvent.enqueuedAt <= TWO_SECONDS) {
                    this._tryRRWebMethod(queuedRRWebEvent)
                }
            })
        }
    }

    private _tryTakeFullSnapshot(): boolean {
        return this._tryRRWebMethod(newQueuedEvent(() => getRRWebRecord()!.takeFullSnapshot()))
    }

    private get _fullSnapshotIntervalMillis(): number {
        if (
            this._triggerMatching.triggerStatus(this.sessionId) === TRIGGER_PENDING &&
            !['sampled', 'active'].includes(this.status)
        ) {
            return ONE_MINUTE
        }

        return this._instance.config.session_recording?.full_snapshot_interval_millis ?? FIVE_MINUTES
    }

    private _scheduleFullSnapshot(): void {
        if (this._fullSnapshotTimer) {
            clearInterval(this._fullSnapshotTimer)
        }
        // we don't schedule snapshots while idle
        if (this._isIdle === true) {
            return
        }

        const interval = this._fullSnapshotIntervalMillis
        if (!interval) {
            return
        }

        this._fullSnapshotTimer = setInterval(() => {
            this._tryTakeFullSnapshot()
        }, interval)
    }

    private _pauseRecording() {
        // we check _urlBlocked not status, since more than one thing can affect status
        if (this._urlTriggerMatching.urlBlocked) {
            return
        }

        // we can't flush the buffer here since someone might be starting on a blocked page.
        // and we need to be sure that we don't record that page,
        // so we might not get the below custom event, but events will report the paused status.
        // which will allow debugging of sessions that start on blocked pages
        this._urlTriggerMatching.urlBlocked = true

        // Clear the snapshot timer since we don't want new snapshots while paused
        clearInterval(this._fullSnapshotTimer)

        logger.info('recording paused due to URL blocker')
        this._tryAddCustomEvent('recording paused', { reason: 'url blocker' })
    }

    private _resumeRecording() {
        // we check _urlBlocked not status, since more than one thing can affect status
        if (!this._urlTriggerMatching.urlBlocked) {
            return
        }

        this._urlTriggerMatching.urlBlocked = false

        this._tryTakeFullSnapshot()
        this._scheduleFullSnapshot()

        this._tryAddCustomEvent('recording resumed', { reason: 'left blocked url' })
        logger.info('recording resumed')
    }

    private _activateTrigger(triggerType: TriggerType) {
        if (this._triggerMatching.triggerStatus(this.sessionId) === TRIGGER_PENDING) {
            // status is stored separately for URL and event triggers
            this._instance?.persistence?.register({
                [triggerType === 'url'
                    ? SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION
                    : SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION]: this._sessionId,
            })

            this._flushBuffer()
            this._reportStarted((triggerType + '_trigger_matched') as SessionStartReason)
        }
    }

    get isStarted(): boolean {
        return !!this._stopRrweb
    }

    get _remoteConfig(): SessionRecordingPersistedConfig | undefined {
        const persistedConfig: any = this._instance.get_property(SESSION_RECORDING_REMOTE_CONFIG)
        if (!persistedConfig) {
            return undefined
        }
        const parsedConfig = isObject(persistedConfig) ? persistedConfig : JSON.parse(persistedConfig)
        return parsedConfig as SessionRecordingPersistedConfig
    }

    private _checkOverride(key: string, overrideFunction: () => void): void {
        const overrideFlag: boolean = this._instance.get_property(key) as boolean
        if (overrideFlag) {
            overrideFunction()

            // Clean up the override flag after applying it
            this._instance.persistence?.unregister(key)
        }
    }

    start(startReason?: SessionStartReason) {
        const config = this._remoteConfig
        if (!config) {
            logger.info('remote config must be stored in persistence before recording can start')
            return
        }

        // We want to ensure the sessionManager is reset if necessary on loading the recorder
        const { sessionId, windowId } = this._sessionManager.checkAndGetSessionAndWindowId()
        this._sessionId = sessionId
        this._windowId = windowId

        if (config?.endpoint) {
            this._endpoint = config?.endpoint
        }

        if (config?.triggerMatchType === 'any') {
            this._statusMatcher = anyMatchSessionRecordingStatus
            this._triggerMatching = new OrTriggerMatching([this._eventTriggerMatching, this._urlTriggerMatching])
        } else {
            // either the setting is "ALL"
            // or we default to the most restrictive
            this._statusMatcher = allMatchSessionRecordingStatus
            this._triggerMatching = new AndTriggerMatching([this._eventTriggerMatching, this._urlTriggerMatching])
        }
        this._instance.register_for_session({
            $sdk_debug_replay_remote_trigger_matching_config: config?.triggerMatchType,
        })

        this._urlTriggerMatching.onConfig(config)

        this._eventTriggerMatching.onConfig(config)
        this._removeEventTriggerCaptureHook?.()
        this._addEventTriggerListener()

        this._linkedFlagMatching.onConfig(config, (flag, variant) => {
            this._reportStarted('linked_flag_matched', {
                flag,
                variant,
            })
        })

        this._checkOverride(SESSION_RECORDING_OVERRIDE_SAMPLING, () => {
            this.overrideSampling()
        })
        this._checkOverride(SESSION_RECORDING_OVERRIDE_LINKED_FLAG, () => {
            this.overrideLinkedFlag()
        })
        this._checkOverride(SESSION_RECORDING_OVERRIDE_EVENT_TRIGGER, () => {
            this.overrideTrigger('event')
        })
        this._checkOverride(SESSION_RECORDING_OVERRIDE_URL_TRIGGER, () => {
            this.overrideTrigger('url')
        })

        this._makeSamplingDecision(this.sessionId)
        this._startRecorder()

        // calling addEventListener multiple times is safe and will not add duplicates
        addEventListener(window, 'beforeunload', this._onBeforeUnload)
        addEventListener(window, 'offline', this._onOffline)
        addEventListener(window, 'online', this._onOnline)
        addEventListener(window, 'visibilitychange', this._onVisibilityChange)

        if (!this._onSessionIdListener) {
            this._onSessionIdListener = this._sessionManager.onSessionId(this._onSessionIdCallback)
        }

        if (!this._onSessionIdleResetForcedListener) {
            this._onSessionIdleResetForcedListener = this._sessionManager.on('forcedIdleReset', () => {
                // a session was forced to reset due to idle timeout and lack of activity
                this._clearConditionalRecordingPersistence()
                this._isIdle = 'unknown'
                this.stop()
                // then we want a session id listener to restart the recording when a new session starts
                this._forceIdleSessionIdListener = this._sessionManager.onSessionId(
                    (sessionId, windowId, changeReason) => {
                        // this should first unregister itself
                        this._forceIdleSessionIdListener?.()
                        this._forceIdleSessionIdListener = undefined
                        this._onSessionIdCallback(sessionId, windowId, changeReason)
                    }
                )
            })
        }

        if (isNullish(this._removePageViewCaptureHook)) {
            // :TRICKY: rrweb does not capture navigation within SPA-s, so hook into our $pageview events to get access to all events.
            //   Dropping the initial event is fine (it's always captured by rrweb).
            this._removePageViewCaptureHook = this._instance.on('eventCaptured', (event) => {
                // If anything could go wrong here,
                // it has the potential to block the main loop,
                // so we catch all errors.
                try {
                    if (event.event === '$pageview') {
                        const href = event?.properties.$current_url ? this._maskUrl(event?.properties.$current_url) : ''
                        if (!href) {
                            return
                        }
                        this._tryAddCustomEvent('$pageview', { href })
                    }
                } catch (e) {
                    logger.error('Could not add $pageview to rrweb session', e)
                }
            })
        }

        if (this.status === ACTIVE) {
            this._reportStarted(startReason || 'recording_initialized')
        }
    }

    private _onSessionIdCallback: SessionIdChangedCallback = (sessionId, windowId, changeReason) => {
        if (!changeReason) return

        const wasLikelyReset = changeReason.noSessionId
        const shouldLinkSessions =
            !wasLikelyReset && (changeReason.activityTimeout || changeReason.sessionPastMaximumLength)

        let oldSessionId, oldWindowId

        if (shouldLinkSessions) {
            oldSessionId = this._sessionId
            oldWindowId = this._windowId
            this._tryAddCustomEvent('$session_ending', {
                nextSessionId: sessionId,
                nextWindowId: windowId,
                changeReason,
                // we'll need to correct the time of this if it's captured when idle
                // so we don't extend reported session time with a debug event
                lastActivityTimestamp: this._lastActivityTimestamp,
                flushed_size: this._flushedSizeTracker?.currentTrackedSize,
            })
        }

        // reset flushed size tracker after capturing the ending event
        if (this._flushedSizeTracker) {
            this._flushedSizeTracker.reset()
        }

        this._tryAddCustomEvent('$session_id_change', { sessionId, windowId, changeReason })

        this._clearConditionalRecordingPersistence()

        if (!this._stopRrweb) {
            this.start('session_id_changed')
        }

        if (shouldLinkSessions) {
            this._tryAddCustomEvent('$session_starting', {
                previousSessionId: oldSessionId,
                previousWindowId: oldWindowId,
                changeReason,
                // we'll need to correct the time of this if it's captured when idle
                // so we don't extend reported session time with a debug event
                lastActivityTimestamp: this._lastActivityTimestamp,
            })
        }

        if (isNumber(this._sampleRate) && isNullish(this._samplingSessionListener)) {
            this._makeSamplingDecision(sessionId)
        }
    }

    stop() {
        window?.removeEventListener('beforeunload', this._onBeforeUnload)
        window?.removeEventListener('offline', this._onOffline)
        window?.removeEventListener('online', this._onOnline)
        window?.removeEventListener('visibilitychange', this._onVisibilityChange)

        this._flushBuffer()
        this._clearBuffer()
        clearInterval(this._fullSnapshotTimer)
        this._clearFlushBufferTimer()

        this._removePageViewCaptureHook?.()
        this._removePageViewCaptureHook = undefined
        this._removeEventTriggerCaptureHook?.()
        this._removeEventTriggerCaptureHook = undefined
        this._onSessionIdListener?.()
        this._onSessionIdListener = undefined
        this._onSessionIdleResetForcedListener?.()
        this._onSessionIdleResetForcedListener = undefined
        this._samplingSessionListener?.()
        this._samplingSessionListener = undefined
        this._forceIdleSessionIdListener?.()
        this._forceIdleSessionIdListener = undefined

        this._eventTriggerMatching.stop()
        this._urlTriggerMatching.stop()
        this._linkedFlagMatching.stop()

        this._mutationThrottler?.stop()

        // Clear any queued rrweb events to prevent memory leaks from closures
        this._queuedRRWebEvents = []

        this._stopRrweb?.()
        this._stopRrweb = undefined

        logger.info('stopped')
    }

    onRRwebEmit(rawEvent: eventWithTime) {
        this._processQueuedEvents()

        if (!rawEvent || !isObject(rawEvent)) {
            return
        }

        if (rawEvent.type === EventType.Meta) {
            const href = this._maskUrl(rawEvent.data.href)
            this._lastHref = href
            if (!href) {
                return
            }
            rawEvent.data.href = href
        } else {
            this._pageViewFallBack()
        }

        // Check if the URL matches any trigger patterns
        this._urlTriggerMatching.checkUrlTriggerConditions(
            () => this._pauseRecording(),
            () => this._resumeRecording(),
            (triggerType) => this._activateTrigger(triggerType),
            this.sessionId
        )
        // always have to check if the URL is blocked really early,
        // or you risk getting stuck in a loop
        if (this._urlTriggerMatching.urlBlocked && !isRecordingPausedEvent(rawEvent)) {
            return
        }

        // we're processing a full snapshot, so we should reset the timer
        if (rawEvent.type === EventType.FullSnapshot) {
            this._scheduleFullSnapshot()
            // Full snapshots reset rrweb's node IDs, so clear any logged node tracking
            this._mutationThrottler?.reset()
        }

        // Clear the buffer if waiting for a trigger and only keep data from after the current full snapshot
        // we always start trigger pending so need to wait for flags before we know if we're really pending
        if (
            rawEvent.type === EventType.FullSnapshot &&
            this._triggerMatching.triggerStatus(this.sessionId) === TRIGGER_PENDING
        ) {
            this._clearBufferBeforeMostRecentMeta()
        }

        const throttledEvent = this._mutationThrottler ? this._mutationThrottler.throttleMutations(rawEvent) : rawEvent

        if (!throttledEvent) {
            return
        }

        // TODO: Re-add ensureMaxMessageSize once we are confident in it
        const event = truncateLargeConsoleLogs(throttledEvent)

        this._updateWindowAndSessionIds(event)

        // When in an idle state we keep recording but don't capture the events,
        // we don't want to return early if idle is 'unknown'
        if (this._isIdle === true && !isAllowedWhenIdle(event)) {
            return
        }

        if (isSessionIdleEvent(event)) {
            // session idle events have a timestamp when rrweb sees them
            // which can artificially lengthen a session
            // we know when we detected it based on the payload and can correct the timestamp
            const payload = event.data.payload as SessionIdlePayload
            if (payload) {
                const lastActivity = payload.lastActivityTimestamp
                const threshold = payload.threshold
                event.timestamp = lastActivity + threshold
            }
        }

        if (isSessionEndingEvent(event) || isSessionStartingEvent(event)) {
            // session ending/starting events have a timestamp when rrweb sees them
            // which can artificially lengthen a session
            // we know when the last activity was based on the payload and can correct the timestamp
            const payload = event.data.payload as { lastActivityTimestamp?: number }
            if (payload?.lastActivityTimestamp) {
                event.timestamp = payload.lastActivityTimestamp
            }
        }

        const eventToSend =
            (this._instance.config.session_recording.compress_events ?? true) ? compressEvent(event) : event
        const size = estimateSize(eventToSend)

        const properties = {
            $snapshot_bytes: size,
            $snapshot_data: eventToSend,
            $session_id: this._sessionId,
            $window_id: this._windowId,
        }

        if (this.status === DISABLED) {
            this._clearBuffer()
            return
        }

        this._captureSnapshotBuffered(properties)
    }

    get status(): SessionRecordingStatus {
        return this._statusMatcher({
            // can't get here without recording being enabled...
            receivedFlags: true,
            isRecordingEnabled: true,
            // things that do still vary
            isSampled: this._isSampled,
            urlTriggerMatching: this._urlTriggerMatching,
            eventTriggerMatching: this._eventTriggerMatching,
            linkedFlagMatching: this._linkedFlagMatching,
            sessionId: this.sessionId,
        })
    }

    log(message: string, level: 'log' | 'warn' | 'error' = 'log') {
        this._instance.sessionRecording?.onRRwebEmit({
            type: 6,
            data: {
                plugin: 'rrweb/console@1',
                payload: {
                    level,
                    trace: [],
                    // Even though it is a string, we stringify it as that's what rrweb expects
                    payload: [JSON.stringify(message)],
                },
            },
            timestamp: Date.now(),
        })
    }

    public overrideLinkedFlag() {
        this._linkedFlagMatching.linkedFlagSeen = true
        this._tryTakeFullSnapshot()
        this._reportStarted('linked_flag_overridden')
    }

    /**
     * this ignores the sampling config and (if other conditions are met) causes capture to start
     *
     * It is not usual to call this directly,
     * instead call `posthog.startSessionRecording({sampling: true})`
     * */
    public overrideSampling() {
        this._instance.persistence?.register({
            // short-circuits the `makeSamplingDecision` function in the session recording module
            [SESSION_RECORDING_IS_SAMPLED]: this.sessionId,
        })
        this._tryTakeFullSnapshot()
        this._reportStarted('sampling_overridden')
    }

    /**
     * this ignores the URL/Event trigger config and (if other conditions are met) causes capture to start
     *
     * It is not usual to call this directly,
     * instead call `posthog.startSessionRecording({trigger: 'url' | 'event'})`
     * */
    public overrideTrigger(triggerType: TriggerType) {
        this._activateTrigger(triggerType)
    }

    private _clearFlushBufferTimer() {
        if (this._flushBufferTimer) {
            clearTimeout(this._flushBufferTimer)
            this._flushBufferTimer = undefined
        }
    }

    private _flushBuffer(): SnapshotBuffer {
        this._clearFlushBufferTimer()

        const isBelowMinimumDuration = this._isBelowMinimumDuration()

        if (this.status === BUFFERING || this.status === PAUSED || this.status === DISABLED || isBelowMinimumDuration) {
            this._flushBufferTimer = setTimeout(() => {
                this._flushBuffer()
            }, RECORDING_BUFFER_TIMEOUT)
            return this._buffer
        }

        if (this._buffer.data.length > 0) {
            const snapshotEvents = splitBuffer(this._buffer)
            snapshotEvents.forEach((snapshotBuffer) => {
                this._flushedSizeTracker?.trackSize(snapshotBuffer.size)
                this._captureSnapshot({
                    $snapshot_bytes: snapshotBuffer.size,
                    $snapshot_data: snapshotBuffer.data,
                    $session_id: snapshotBuffer.sessionId,
                    $window_id: snapshotBuffer.windowId,
                    $lib: 'web',
                    $lib_version: Config.LIB_VERSION,
                })
            })
        }

        // buffer is empty, we clear it in case the session id has changed
        return this._clearBuffer()
    }

    private _hasPassedMinimumDuration = (): boolean => {
        const persistedSessionId = this._instance.persistence?.props[SESSION_RECORDING_PAST_MINIMUM_DURATION]
        return persistedSessionId === this._sessionId
    }

    private _getBufferDuration = (): number | null => {
        if (this._buffer.data.length === 0) {
            return null
        }

        const firstTimestamp = this._buffer.data[0]?.timestamp
        const lastTimestamp = this._buffer.data[this._buffer.data.length - 1]?.timestamp

        if (!isNumber(firstTimestamp) || !isNumber(lastTimestamp)) {
            return null
        }

        return lastTimestamp - firstTimestamp
    }

    private _isBelowMinimumDuration = (): boolean => {
        const minimumDuration = this._minimumDuration
        if (!isNumber(minimumDuration)) {
            return false
        }

        const strictMode = this._instance.config.session_recording?.strictMinimumDuration ?? false

        if (!strictMode) {
            const sessionDuration = this._sessionDuration
            const isPositiveSessionDuration = isNumber(sessionDuration) && sessionDuration >= 0
            return isPositiveSessionDuration && sessionDuration < minimumDuration
        }

        if (this._hasPassedMinimumDuration()) {
            return false
        }

        const bufferDuration = this._getBufferDuration()
        if (isNull(bufferDuration)) {
            return true
        }

        if (bufferDuration >= minimumDuration) {
            this._instance.persistence?.register({
                [SESSION_RECORDING_PAST_MINIMUM_DURATION]: this._sessionId,
            })
            return false
        }

        return true
    }

    private _captureSnapshotBuffered(properties: Properties) {
        const additionalBytes = 2 + (this._buffer?.data.length || 0) // 2 bytes for the array brackets and 1 byte for each comma
        if (
            !this._isIdle && // we never want to flush when idle
            (this._buffer.size + properties.$snapshot_bytes + additionalBytes > RECORDING_MAX_EVENT_SIZE ||
                this._buffer.sessionId !== this._sessionId)
        ) {
            this._buffer = this._flushBuffer()
        }

        this._buffer.size += properties.$snapshot_bytes
        this._buffer.data.push(properties.$snapshot_data)

        if (!this._flushBufferTimer && !this._isIdle) {
            this._flushBufferTimer = setTimeout(() => {
                this._flushBuffer()
            }, RECORDING_BUFFER_TIMEOUT)
        }
    }

    private _captureSnapshot(properties: Properties) {
        // :TRICKY: Make sure we batch these requests, use a custom endpoint and don't truncate the strings.
        this._instance.capture('$snapshot', properties, {
            _url: this._instance.requestRouter.endpointFor('api', this._endpoint),
            _noTruncate: true,
            _batchKey: SESSION_RECORDING_BATCH_KEY,
            skip_client_rate_limiting: true,
        })
    }

    private get _sessionDuration(): number | null {
        const mostRecentSnapshot = this._buffer?.data[this._buffer?.data.length - 1]
        const { sessionStartTimestamp } = this._sessionManager.checkAndGetSessionAndWindowId(true)
        return mostRecentSnapshot ? mostRecentSnapshot.timestamp - sessionStartTimestamp : null
    }

    private _clearBufferBeforeMostRecentMeta(): SnapshotBuffer {
        if (!this._buffer || this._buffer.data.length === 0) {
            return this._clearBuffer()
        }

        // Find the last meta event index by iterating backwards
        let lastMetaIndex = -1
        for (let i = this._buffer.data.length - 1; i >= 0; i--) {
            if (this._buffer.data[i].type === EventType.Meta) {
                lastMetaIndex = i
                break
            }
        }
        if (lastMetaIndex >= 0) {
            this._buffer.data = this._buffer.data.slice(lastMetaIndex)
            this._buffer.size = this._buffer.data.reduce((acc, curr) => acc + estimateSize(curr), 0)
            return this._buffer
        } else {
            return this._clearBuffer()
        }
    }

    private _clearBuffer(): SnapshotBuffer {
        this._buffer = {
            size: 0,
            data: [],
            sessionId: this._sessionId,
            windowId: this._windowId,
        }
        return this._buffer
    }

    private _onBeforeUnload = (): void => {
        this._flushBuffer()
    }

    private _onOffline = (): void => {
        this._tryAddCustomEvent('browser offline', {})
    }

    private _onOnline = (): void => {
        this._tryAddCustomEvent('browser online', {})
    }

    private _onVisibilityChange = (): void => {
        if (document?.visibilityState) {
            const label = 'window ' + document.visibilityState
            this._tryAddCustomEvent(label, {})
        }
    }

    private _reportStarted(startReason: SessionStartReason, tagPayload?: Record<string, any>) {
        this._instance.register_for_session({
            $session_recording_start_reason: startReason,
        })
        logger.info(startReason.replace('_', ' '), tagPayload)
        if (!includes(['recording_initialized', 'session_id_changed'], startReason)) {
            this._tryAddCustomEvent(startReason, tagPayload)
        }
    }

    private _isInteractiveEvent(event: eventWithTime) {
        return (
            event.type === INCREMENTAL_SNAPSHOT_EVENT_TYPE &&
            ACTIVE_SOURCES.indexOf(event.data?.source as IncrementalSource) !== -1
        )
    }

    private _updateWindowAndSessionIds(event: eventWithTime) {
        // Some recording events are triggered by non-user events (e.g. "X minutes ago" text updating on the screen).
        // We don't want to extend the session or trigger a new session in these cases. These events are designated by event
        // type -> incremental update, and source -> mutation.

        const isUserInteraction = this._isInteractiveEvent(event)

        if (!isUserInteraction && !this._isIdle) {
            // We check if the lastActivityTimestamp is old enough to go idle
            const timeSinceLastActivity = event.timestamp - this._lastActivityTimestamp
            if (timeSinceLastActivity > this._sessionIdleThresholdMilliseconds) {
                // we mark as idle right away,
                // or else we get multiple idle events
                // if there are lots of non-user activity events being emitted
                this._isIdle = true

                // don't take full snapshots while idle
                clearInterval(this._fullSnapshotTimer)

                this._tryAddCustomEvent('sessionIdle', {
                    eventTimestamp: event.timestamp,
                    lastActivityTimestamp: this._lastActivityTimestamp,
                    threshold: this._sessionIdleThresholdMilliseconds,
                    bufferLength: this._buffer.data.length,
                    bufferSize: this._buffer.size,
                })

                // proactively flush the buffer in case the session is idle for a long time
                this._flushBuffer()
            }
        }

        let returningFromIdle = false
        if (isUserInteraction) {
            this._lastActivityTimestamp = event.timestamp
            if (this._isIdle) {
                const idleWasUnknown = this._isIdle === 'unknown'
                // Remove the idle state
                this._isIdle = false
                // if the idle state was unknown, we don't want to add an event, since we're just in bootup
                // whereas if it was true, we know we've been idle for a while, and we can mark ourselves as returning from idle
                if (!idleWasUnknown) {
                    this._tryAddCustomEvent('sessionNoLongerIdle', {
                        reason: 'user activity',
                        type: event.type,
                    })
                    returningFromIdle = true
                }
            }
        }

        if (this._isIdle) {
            return
        }

        // We only want to extend the session if it is an interactive event.
        const { windowId, sessionId } = this._sessionManager.checkAndGetSessionAndWindowId(
            !isUserInteraction,
            event.timestamp
        )

        const sessionIdChanged = this._sessionId !== sessionId
        const windowIdChanged = this._windowId !== windowId

        this._windowId = windowId
        this._sessionId = sessionId

        if (sessionIdChanged || windowIdChanged) {
            this.stop()
            this.start('session_id_changed')
        } else if (returningFromIdle) {
            this._scheduleFullSnapshot()
        }
    }

    private _clearConditionalRecordingPersistence(): void {
        this._instance?.persistence?.unregister(SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION)
        this._instance?.persistence?.unregister(SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION)
        this._instance?.persistence?.unregister(SESSION_RECORDING_IS_SAMPLED)
        this._instance?.persistence?.unregister(SESSION_RECORDING_PAST_MINIMUM_DURATION)
    }

    private _makeSamplingDecision(sessionId: string): void {
        const sessionIdChanged = this._sessionId !== sessionId

        // capture the current sample rate
        // because it is re-used multiple times
        // and the bundler won't minimize any of the references
        const currentSampleRate = this._sampleRate

        if (!isNumber(currentSampleRate)) {
            this._instance.persistence?.unregister(SESSION_RECORDING_IS_SAMPLED)
            return
        }

        const storedIsSampled = this._isSampled

        /**
         * if we get this far, then we should make a sampling decision.
         * When the session id changes or there is no stored sampling decision for this session id
         * then we should make a new decision.
         *
         * Otherwise, we should use the stored decision.
         */
        const makeDecision = sessionIdChanged || !isBoolean(storedIsSampled)
        const shouldSample = makeDecision ? sampleOnProperty(sessionId, currentSampleRate) : storedIsSampled

        if (makeDecision) {
            if (shouldSample) {
                this._reportStarted(SAMPLED)
            } else {
                logger.warn(
                    `Sample rate (${currentSampleRate}) has determined that this sessionId (${sessionId}) will not be sent to the server.`
                )
            }

            this._tryAddCustomEvent('samplingDecisionMade', {
                sampleRate: currentSampleRate,
                isSampled: shouldSample,
            })
        }

        this._instance.persistence?.register({
            [SESSION_RECORDING_IS_SAMPLED]: shouldSample ? sessionId : false,
        })
    }

    private _addEventTriggerListener() {
        if (this._eventTriggerMatching._eventTriggers.length === 0 || !isNullish(this._removeEventTriggerCaptureHook)) {
            return
        }

        this._removeEventTriggerCaptureHook = this._instance.on('eventCaptured', (event: CaptureResult) => {
            // If anything could go wrong here, it has the potential to block the main loop,
            // so we catch all errors.
            try {
                if (this._eventTriggerMatching._eventTriggers.includes(event.event)) {
                    this._activateTrigger('event')
                }
            } catch (e) {
                logger.error('Could not activate event trigger', e)
            }
        })
    }

    get sdkDebugProperties(): Properties {
        const { sessionStartTimestamp } = this._sessionManager.checkAndGetSessionAndWindowId(true)

        return {
            $recording_status: this.status,
            $sdk_debug_replay_internal_buffer_length: this._buffer.data.length,
            $sdk_debug_replay_internal_buffer_size: this._buffer.size,
            $sdk_debug_current_session_duration: this._sessionDuration,
            $sdk_debug_session_start: sessionStartTimestamp,
            $sdk_debug_replay_flushed_size: this._flushedSizeTracker?.currentTrackedSize,
        }
    }

    private _startRecorder() {
        if (this._stopRrweb) {
            return
        }

        // rrweb config info: https://github.com/rrweb-io/rrweb/blob/7d5d0033258d6c29599fb08412202d9a2c7b9413/src/record/index.ts#L28
        const sessionRecordingOptions: recordOptions = {
            // a limited set of the rrweb config options that we expose to our users.
            // see https://github.com/rrweb-io/rrweb/blob/master/guide.md
            blockClass: 'ph-no-capture',
            blockSelector: undefined,
            ignoreClass: 'ph-ignore-input',
            maskTextClass: 'ph-mask',
            maskTextSelector: undefined,
            maskTextFn: undefined,
            maskAllInputs: true,
            maskInputOptions: { password: true },
            maskInputFn: undefined,
            slimDOMOptions: {},
            collectFonts: false,
            inlineStylesheet: true,
            recordCrossOriginIframes: false,
        }

        // only allows user to set our allowlisted options
        const userSessionRecordingOptions = this._instance.config.session_recording
        for (const [key, value] of Object.entries(userSessionRecordingOptions || {})) {
            if (key in sessionRecordingOptions) {
                if (key === 'maskInputOptions') {
                    // ensure password config is set if not included
                    sessionRecordingOptions.maskInputOptions = { password: true, ...value }
                } else {
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    sessionRecordingOptions[key] = value
                }
            }
        }

        if (this._canvasRecording && this._canvasRecording.enabled) {
            sessionRecordingOptions.recordCanvas = true
            sessionRecordingOptions.sampling = { canvas: this._canvasRecording.fps }
            sessionRecordingOptions.dataURLOptions = { type: 'image/webp', quality: this._canvasRecording.quality }
        }

        if (this._masking) {
            sessionRecordingOptions.maskAllInputs = this._masking.maskAllInputs ?? true
            sessionRecordingOptions.maskTextSelector = this._masking.maskTextSelector ?? undefined
            sessionRecordingOptions.blockSelector = this._masking.blockSelector ?? undefined
        }

        const rrwebRecord = getRRWebRecord()
        if (!rrwebRecord) {
            logger.error(
                '_startRecorder was called but rrwebRecord is not available. This indicates something has gone wrong.'
            )
            return
        }

        this._mutationThrottler =
            this._mutationThrottler ??
            new MutationThrottler(rrwebRecord, {
                refillRate: this._instance.config.session_recording.__mutationThrottlerRefillRate,
                bucketSize: this._instance.config.session_recording.__mutationThrottlerBucketSize,
                onBlockedNode: (id, node) => {
                    const message = `Too many mutations on node '${id}'. Rate limiting. This could be due to SVG animations or something similar`
                    logger.info(message, {
                        node: node,
                    })

                    this.log(LOGGER_PREFIX + ' ' + message, 'warn')
                },
            })

        const activePlugins = this._gatherRRWebPlugins()
        this._stopRrweb = rrwebRecord({
            emit: (event) => {
                this.onRRwebEmit(event)
            },
            plugins: activePlugins,
            ...sessionRecordingOptions,
        })

        // We reset the last activity timestamp, resetting the idle timer
        this._lastActivityTimestamp = Date.now()
        // stay unknown if we're not sure if we're idle or not
        this._isIdle = isBoolean(this._isIdle) ? this._isIdle : 'unknown'

        this.tryAddCustomEvent('$remote_config_received', this._remoteConfig)
        this._tryAddCustomEvent('$session_options', {
            sessionRecordingOptions,
            activePlugins: activePlugins.map((p) => p?.name),
        })

        this._tryAddCustomEvent('$posthog_config', {
            config: this._instance.config,
        })
    }

    tryAddCustomEvent(tag: string, payload: any): boolean {
        return this._tryAddCustomEvent(tag, payload)
    }
}
