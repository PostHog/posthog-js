import {
    CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_RECORDING_CANVAS_RECORDING,
    SESSION_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION,
    SESSION_RECORDING_IS_SAMPLED,
    SESSION_RECORDING_MINIMUM_DURATION,
    SESSION_RECORDING_NETWORK_PAYLOAD_CAPTURE,
    SESSION_RECORDING_SAMPLE_RATE,
    SESSION_RECORDING_SCRIPT_CONFIG,
    SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION,
} from '../../constants'
import {
    estimateSize,
    INCREMENTAL_SNAPSHOT_EVENT_TYPE,
    recordOptions,
    rrwebRecord,
    splitBuffer,
    truncateLargeConsoleLogs,
} from './sessionrecording-utils'
import { PostHog } from '../../posthog-core'
import {
    CaptureResult,
    FlagVariant,
    NetworkRecordOptions,
    NetworkRequest,
    Properties,
    RemoteConfig,
    SessionRecordingUrlTrigger,
} from '../../types'
import {
    customEvent,
    EventType,
    type eventWithTime,
    IncrementalSource,
    type listenerHandler,
    RecordPlugin,
} from '@rrweb/types'

import { isBoolean, isFunction, isNullish, isNumber, isObject, isString, isUndefined } from '../../utils/type-utils'
import { createLogger } from '../../utils/logger'
import { assignableWindow, document, PostHogExtensionKind, window } from '../../utils/globals'
import { buildNetworkRequestOptions } from './config'
import { isLocalhost } from '../../utils/request-utils'
import { MutationRateLimiter } from './mutation-rate-limiter'
import { gzipSync, strFromU8, strToU8 } from 'fflate'
import { clampToRange } from '../../utils/number-utils'
import Config from '../../config'
import { includes } from '../../utils/string-utils'

const LOGGER_PREFIX = '[SessionRecording]'
const logger = createLogger(LOGGER_PREFIX)

type SessionStartReason =
    | 'sampling_overridden'
    | 'recording_initialized'
    | 'linked_flag_matched'
    | 'linked_flag_overridden'
    | 'sampled'
    | 'session_id_changed'
    | 'url_trigger_matched'
    | 'event_trigger_matched'

const BASE_ENDPOINT = '/s/'

const ONE_MINUTE = 1000 * 60
const FIVE_MINUTES = ONE_MINUTE * 5
const TWO_SECONDS = 2000
export const RECORDING_IDLE_THRESHOLD_MS = FIVE_MINUTES
const ONE_KB = 1024
const PARTIAL_COMPRESSION_THRESHOLD = ONE_KB
export const RECORDING_MAX_EVENT_SIZE = ONE_KB * ONE_KB * 0.9 // ~1mb (with some wiggle room)
export const RECORDING_BUFFER_TIMEOUT = 2000 // 2 seconds
export const SESSION_RECORDING_BATCH_KEY = 'recordings'

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

export type TriggerType = 'url' | 'event'
type TriggerStatus = 'trigger_activated' | 'trigger_pending' | 'trigger_disabled'

/**
 * Session recording starts in buffering mode while waiting for decide response
 * Once the response is received it might be disabled, active or sampled
 * When sampled that means a sample rate is set and the last time the session id was rotated
 * the sample rate determined this session should be sent to the server.
 */
type SessionRecordingStatus = 'disabled' | 'sampled' | 'active' | 'buffering' | 'paused'

export interface SnapshotBuffer {
    size: number
    data: any[]
    sessionId: string
    windowId: string
}

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

const newQueuedEvent = (rrwebMethod: () => void): QueuedRRWebEvent => ({
    rrwebMethod,
    enqueuedAt: Date.now(),
    attempt: 1,
})

type compressedFullSnapshotEvent = {
    type: EventType.FullSnapshot
    data: string
}

type compressedIncrementalSnapshotEvent = {
    type: EventType.IncrementalSnapshot
    data: {
        source: IncrementalSource
        texts: string
        attributes: string
        removes: string
        adds: string
    }
}

type compressedIncrementalStyleSnapshotEvent = {
    type: EventType.IncrementalSnapshot
    data: {
        source: IncrementalSource.StyleSheetRule
        id?: number
        styleId?: number
        replace?: string
        replaceSync?: string
        adds: string
        removes: string
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

// rrweb's packer takes an event and returns a string or the reverse on unpact,
// but we want to be able to inspect metadata during ingestion, and don't want to compress the entire event
// so we have a custom packer that only compresses part of some events
function compressEvent(event: eventWithTime): eventWithTime | compressedEventWithTime {
    const originalSize = estimateSize(event)
    if (originalSize < PARTIAL_COMPRESSION_THRESHOLD) {
        return event
    }

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
                    adds: gzipToString(event.data.adds),
                    removes: gzipToString(event.data.removes),
                },
            }
        }
    } catch (e) {
        logger.error('could not compress event - will use uncompressed event', e)
    }
    return event
}

function isSessionIdleEvent(e: eventWithTime): e is eventWithTime & customEvent {
    return e.type === EventType.Custom && e.data.tag === 'sessionIdle'
}

function sessionRecordingUrlTriggerMatches(url: string, triggers: SessionRecordingUrlTrigger[]) {
    return triggers.some((trigger) => {
        switch (trigger.matching) {
            case 'regex':
                return new RegExp(trigger.url).test(url)
            default:
                return false
        }
    })
}

/** When we put the recording into a paused state, we add a custom event.
 *  However in the paused state, events are dropped, and never make it to the buffer,
 *  so we need to manually let this one through */
function isRecordingPausedEvent(e: eventWithTime) {
    return e.type === EventType.Custom && e.data.tag === 'recording paused'
}

export class SessionRecording {
    private _endpoint: string
    private flushBufferTimer?: any

    // we have a buffer - that contains PostHog snapshot events ready to be sent to the server
    private buffer: SnapshotBuffer
    // and a queue - that contains rrweb events that we want to send to rrweb, but rrweb wasn't able to accept them yet
    private queuedRRWebEvents: QueuedRRWebEvent[] = []

    private mutationRateLimiter?: MutationRateLimiter
    private _captureStarted: boolean
    private stopRrweb: listenerHandler | undefined
    private receivedDecide: boolean
    private isIdle = false

    private _linkedFlagSeen: boolean = false
    private _lastActivityTimestamp: number = Date.now()
    private windowId: string
    private sessionId: string
    private _linkedFlag: string | FlagVariant | null = null

    private _fullSnapshotTimer?: ReturnType<typeof setInterval>

    private _removePageViewCaptureHook: (() => void) | undefined = undefined
    private _onSessionIdListener: (() => void) | undefined = undefined
    private _persistDecideOnSessionListener: (() => void) | undefined = undefined
    private _samplingSessionListener: (() => void) | undefined = undefined

    // if pageview capture is disabled
    // then we can manually track href changes
    private _lastHref?: string

    private _urlTriggers: SessionRecordingUrlTrigger[] = []
    private _urlBlocklist: SessionRecordingUrlTrigger[] = []

    private _urlBlocked: boolean = false

    private _eventTriggers: string[] = []
    private _removeEventTriggerCaptureHook: (() => void) | undefined = undefined

    // Util to help developers working on this feature manually override
    _forceAllowLocalhostNetworkCapture = false

    private get sessionIdleThresholdMilliseconds(): number {
        return this.instance.config.session_recording.session_idle_threshold_ms || RECORDING_IDLE_THRESHOLD_MS
    }

    private get rrwebRecord(): rrwebRecord | undefined {
        return assignableWindow?.__PosthogExtensions__?.rrweb?.record
    }

    public get started(): boolean {
        // TODO could we use status instead of _captureStarted?
        return this._captureStarted
    }

    private get sessionManager() {
        if (!this.instance.sessionManager) {
            throw new Error(LOGGER_PREFIX + ' must be started with a valid sessionManager.')
        }

        return this.instance.sessionManager
    }

    private get fullSnapshotIntervalMillis(): number {
        if (this.triggerStatus === 'trigger_pending') {
            return ONE_MINUTE
        }

        return this.instance.config.session_recording?.full_snapshot_interval_millis ?? FIVE_MINUTES
    }

    private get isSampled(): boolean | null {
        const currentValue = this.instance.get_property(SESSION_RECORDING_IS_SAMPLED)
        return isBoolean(currentValue) ? currentValue : null
    }

    private get sessionDuration(): number | null {
        const mostRecentSnapshot = this.buffer?.data[this.buffer?.data.length - 1]
        const { sessionStartTimestamp } = this.sessionManager.checkAndGetSessionAndWindowId(true)
        return mostRecentSnapshot ? mostRecentSnapshot.timestamp - sessionStartTimestamp : null
    }

    private get isRecordingEnabled() {
        const enabled_server_side = !!this.instance.get_property(SESSION_RECORDING_ENABLED_SERVER_SIDE)
        const enabled_client_side = !this.instance.config.disable_session_recording
        return window && enabled_server_side && enabled_client_side
    }

    private get isConsoleLogCaptureEnabled() {
        const enabled_server_side = !!this.instance.get_property(CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE)
        const enabled_client_side = this.instance.config.enable_recording_console_log
        return enabled_client_side ?? enabled_server_side
    }

    private get canvasRecording(): { enabled: boolean; fps: number; quality: number } {
        const canvasRecording_client_side = this.instance.config.session_recording.captureCanvas
        const canvasRecording_server_side = this.instance.get_property(SESSION_RECORDING_CANVAS_RECORDING)

        const enabled = canvasRecording_client_side?.recordCanvas ?? canvasRecording_server_side?.enabled ?? false
        const fps = canvasRecording_client_side?.canvasFps ?? canvasRecording_server_side?.fps ?? 0
        const quality = canvasRecording_client_side?.canvasQuality ?? canvasRecording_server_side?.quality ?? 0

        return {
            enabled,
            fps: clampToRange(fps, 0, 12, 'canvas recording fps'),
            quality: clampToRange(quality, 0, 1, 'canvas recording quality'),
        }
    }

    // network payload capture config has three parts
    // each can be configured server side or client side
    private get networkPayloadCapture():
        | Pick<NetworkRecordOptions, 'recordHeaders' | 'recordBody' | 'recordPerformance'>
        | undefined {
        const networkPayloadCapture_server_side = this.instance.get_property(SESSION_RECORDING_NETWORK_PAYLOAD_CAPTURE)
        const networkPayloadCapture_client_side = {
            recordHeaders: this.instance.config.session_recording?.recordHeaders,
            recordBody: this.instance.config.session_recording?.recordBody,
        }
        const headersEnabled =
            networkPayloadCapture_client_side?.recordHeaders || networkPayloadCapture_server_side?.recordHeaders
        const bodyEnabled =
            networkPayloadCapture_client_side?.recordBody || networkPayloadCapture_server_side?.recordBody
        const clientConfigForPerformanceCapture = isObject(this.instance.config.capture_performance)
            ? this.instance.config.capture_performance.network_timing
            : this.instance.config.capture_performance
        const networkTimingEnabled = !!(isBoolean(clientConfigForPerformanceCapture)
            ? clientConfigForPerformanceCapture
            : networkPayloadCapture_server_side?.capturePerformance)

        return headersEnabled || bodyEnabled || networkTimingEnabled
            ? { recordHeaders: headersEnabled, recordBody: bodyEnabled, recordPerformance: networkTimingEnabled }
            : undefined
    }

    private get sampleRate(): number | null {
        const rate = this.instance.get_property(SESSION_RECORDING_SAMPLE_RATE)
        return isNumber(rate) ? rate : null
    }

    private get minimumDuration(): number | null {
        const duration = this.instance.get_property(SESSION_RECORDING_MINIMUM_DURATION)
        return isNumber(duration) ? duration : null
    }

    /**
     * defaults to buffering mode until a decide response is received
     * once a decide response is received status can be disabled, active or sampled
     */
    get status(): SessionRecordingStatus {
        if (!this.receivedDecide) {
            return 'buffering'
        }

        if (!this.isRecordingEnabled) {
            return 'disabled'
        }

        if (this._urlBlocked) {
            return 'paused'
        }

        if (!isNullish(this._linkedFlag) && !this._linkedFlagSeen) {
            return 'buffering'
        }

        if (this.triggerStatus === 'trigger_pending') {
            return 'buffering'
        }

        if (isBoolean(this.isSampled)) {
            return this.isSampled ? 'sampled' : 'disabled'
        } else {
            return 'active'
        }
    }

    private get urlTriggerStatus(): TriggerStatus {
        if (this._urlTriggers.length === 0) {
            return 'trigger_disabled'
        }

        const currentTriggerSession = this.instance?.get_property(SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION)
        return currentTriggerSession === this.sessionId ? 'trigger_activated' : 'trigger_pending'
    }

    private get eventTriggerStatus(): TriggerStatus {
        if (this._eventTriggers.length === 0) {
            return 'trigger_disabled'
        }

        const currentTriggerSession = this.instance?.get_property(SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION)
        return currentTriggerSession === this.sessionId ? 'trigger_activated' : 'trigger_pending'
    }

    private get triggerStatus(): TriggerStatus {
        const eitherIsActivated =
            this.eventTriggerStatus === 'trigger_activated' || this.urlTriggerStatus === 'trigger_activated'
        const eitherIsPending =
            this.eventTriggerStatus === 'trigger_pending' || this.urlTriggerStatus === 'trigger_pending'
        return eitherIsActivated ? 'trigger_activated' : eitherIsPending ? 'trigger_pending' : 'trigger_disabled'
    }

    constructor(private readonly instance: PostHog) {
        this._captureStarted = false
        this._endpoint = BASE_ENDPOINT
        this.stopRrweb = undefined
        this.receivedDecide = false

        if (!this.instance.sessionManager) {
            logger.error('started without valid sessionManager')
            throw new Error(LOGGER_PREFIX + ' started without valid sessionManager. This is a bug.')
        }
        if (this.instance.config.__preview_experimental_cookieless_mode) {
            throw new Error(LOGGER_PREFIX + ' cannot be used with __preview_experimental_cookieless_mode.')
        }

        // we know there's a sessionManager, so don't need to start without a session id
        const { sessionId, windowId } = this.sessionManager.checkAndGetSessionAndWindowId()
        this.sessionId = sessionId
        this.windowId = windowId

        this.buffer = this.clearBuffer()

        if (this.sessionIdleThresholdMilliseconds >= this.sessionManager.sessionTimeoutMs) {
            logger.warn(
                `session_idle_threshold_ms (${this.sessionIdleThresholdMilliseconds}) is greater than the session timeout (${this.sessionManager.sessionTimeoutMs}). Session will never be detected as idle`
            )
        }
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

    startIfEnabledOrStop(startReason?: SessionStartReason) {
        if (this.isRecordingEnabled) {
            this._startCapture(startReason)

            // calling addEventListener multiple times is safe and will not add duplicates
            window?.addEventListener('beforeunload', this._onBeforeUnload)
            window?.addEventListener('offline', this._onOffline)
            window?.addEventListener('online', this._onOnline)
            window?.addEventListener('visibilitychange', this._onVisibilityChange)

            // on reload there might be an already sampled session that should be continued before decide response,
            // so we call this here _and_ in the decide response
            this._setupSampling()

            this._addEventTriggerListener()

            if (isNullish(this._removePageViewCaptureHook)) {
                // :TRICKY: rrweb does not capture navigation within SPA-s, so hook into our $pageview events to get access to all events.
                //   Dropping the initial event is fine (it's always captured by rrweb).
                this._removePageViewCaptureHook = this.instance.on('eventCaptured', (event) => {
                    // If anything could go wrong here it has the potential to block the main loop,
                    // so we catch all errors.
                    try {
                        if (event.event === '$pageview') {
                            const href = event?.properties.$current_url
                                ? this._maskUrl(event?.properties.$current_url)
                                : ''
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

            if (!this._onSessionIdListener) {
                this._onSessionIdListener = this.sessionManager.onSessionId((sessionId, windowId, changeReason) => {
                    if (changeReason) {
                        this._tryAddCustomEvent('$session_id_change', { sessionId, windowId, changeReason })

                        this.instance?.persistence?.unregister(SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION)
                        this.instance?.persistence?.unregister(SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION)
                    }
                })
            }
        } else {
            this.stopRecording()
        }
    }

    stopRecording() {
        if (this._captureStarted && this.stopRrweb) {
            this.stopRrweb()
            this.stopRrweb = undefined
            this._captureStarted = false

            window?.removeEventListener('beforeunload', this._onBeforeUnload)
            window?.removeEventListener('offline', this._onOffline)
            window?.removeEventListener('online', this._onOnline)
            window?.removeEventListener('visibilitychange', this._onVisibilityChange)

            this.clearBuffer()
            clearInterval(this._fullSnapshotTimer)

            this._removePageViewCaptureHook?.()
            this._removePageViewCaptureHook = undefined
            this._removeEventTriggerCaptureHook?.()
            this._removeEventTriggerCaptureHook = undefined
            this._onSessionIdListener?.()
            this._onSessionIdListener = undefined
            this._samplingSessionListener?.()
            this._samplingSessionListener = undefined

            logger.info('stopped')
        }
    }

    private makeSamplingDecision(sessionId: string): void {
        const sessionIdChanged = this.sessionId !== sessionId

        // capture the current sample rate,
        // because it is re-used multiple times
        // and the bundler won't minimise any of the references
        const currentSampleRate = this.sampleRate

        if (!isNumber(currentSampleRate)) {
            this.instance.persistence?.register({
                [SESSION_RECORDING_IS_SAMPLED]: null,
            })
            return
        }

        const storedIsSampled = this.isSampled

        /**
         * if we get this far then we should make a sampling decision.
         * When the session id changes or there is no stored sampling decision for this session id
         * then we should make a new decision.
         *
         * Otherwise, we should use the stored decision.
         */
        let shouldSample: boolean
        const makeDecision = sessionIdChanged || !isBoolean(storedIsSampled)
        if (makeDecision) {
            const randomNumber = Math.random()
            shouldSample = randomNumber < currentSampleRate
        } else {
            shouldSample = storedIsSampled
        }

        if (makeDecision) {
            if (shouldSample) {
                this._reportStarted('sampled')
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

        this.instance.persistence?.register({
            [SESSION_RECORDING_IS_SAMPLED]: shouldSample,
        })
    }

    onRemoteConfig(response: RemoteConfig) {
        this._persistRemoteConfig(response)

        this._linkedFlag = response.sessionRecording?.linkedFlag || null

        if (response.sessionRecording?.endpoint) {
            this._endpoint = response.sessionRecording?.endpoint
        }

        this._setupSampling()

        if (!isNullish(this._linkedFlag) && !this._linkedFlagSeen) {
            const linkedFlag = isString(this._linkedFlag) ? this._linkedFlag : this._linkedFlag.flag
            const linkedVariant = isString(this._linkedFlag) ? null : this._linkedFlag.variant
            this.instance.onFeatureFlags((_flags, variants) => {
                const flagIsPresent = isObject(variants) && linkedFlag in variants
                const linkedFlagMatches = linkedVariant ? variants[linkedFlag] === linkedVariant : flagIsPresent
                if (linkedFlagMatches) {
                    this._reportStarted('linked_flag_matched', {
                        linkedFlag,
                        linkedVariant,
                    })
                }
                this._linkedFlagSeen = linkedFlagMatches
            })
        }

        if (response.sessionRecording?.urlTriggers) {
            this._urlTriggers = response.sessionRecording.urlTriggers
        }

        if (response.sessionRecording?.urlBlocklist) {
            this._urlBlocklist = response.sessionRecording.urlBlocklist
        }

        if (response.sessionRecording?.eventTriggers) {
            this._eventTriggers = response.sessionRecording.eventTriggers
        }

        this.receivedDecide = true
        this.startIfEnabledOrStop()
    }

    /**
     * This might be called more than once so needs to be idempotent
     */
    private _setupSampling() {
        if (isNumber(this.sampleRate) && isNullish(this._samplingSessionListener)) {
            this._samplingSessionListener = this.sessionManager.onSessionId((sessionId) => {
                this.makeSamplingDecision(sessionId)
            })
        }
    }

    private _persistRemoteConfig(response: RemoteConfig): void {
        if (this.instance.persistence) {
            const persistence = this.instance.persistence

            const persistResponse = () => {
                const receivedSampleRate = response.sessionRecording?.sampleRate

                const parsedSampleRate = isNullish(receivedSampleRate) ? null : parseFloat(receivedSampleRate)
                const receivedMinimumDuration = response.sessionRecording?.minimumDurationMilliseconds

                persistence.register({
                    [SESSION_RECORDING_ENABLED_SERVER_SIDE]: !!response['sessionRecording'],
                    [CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE]: response.sessionRecording?.consoleLogRecordingEnabled,
                    [SESSION_RECORDING_NETWORK_PAYLOAD_CAPTURE]: {
                        capturePerformance: response.capturePerformance,
                        ...response.sessionRecording?.networkPayloadCapture,
                    },
                    [SESSION_RECORDING_CANVAS_RECORDING]: {
                        enabled: response.sessionRecording?.recordCanvas,
                        fps: response.sessionRecording?.canvasFps,
                        quality: response.sessionRecording?.canvasQuality,
                    },
                    [SESSION_RECORDING_SAMPLE_RATE]: parsedSampleRate,
                    [SESSION_RECORDING_MINIMUM_DURATION]: isUndefined(receivedMinimumDuration)
                        ? null
                        : receivedMinimumDuration,
                    [SESSION_RECORDING_SCRIPT_CONFIG]: response.sessionRecording?.scriptConfig,
                })
            }

            persistResponse()

            // in case we see multiple decide responses, we should only listen with the response from the most recent one
            this._persistDecideOnSessionListener?.()
            this._persistDecideOnSessionListener = this.sessionManager.onSessionId(persistResponse)
        }
    }

    log(message: string, level: 'log' | 'warn' | 'error' = 'log') {
        this.instance.sessionRecording?.onRRwebEmit({
            type: 6,
            data: {
                plugin: 'rrweb/console@1',
                payload: {
                    level,
                    trace: [],
                    // Even though it is a string we stringify it as that's what rrweb expects
                    payload: [JSON.stringify(message)],
                },
            },
            timestamp: Date.now(),
        })
    }

    private _startCapture(startReason?: SessionStartReason) {
        if (isUndefined(Object.assign) || isUndefined(Array.from)) {
            // According to the rrweb docs, rrweb is not supported on IE11 and below:
            // "rrweb does not support IE11 and below because it uses the MutationObserver API which was supported by these browsers."
            // https://github.com/rrweb-io/rrweb/blob/master/guide.md#compatibility-note
            //
            // However, MutationObserver does exist on IE11, it just doesn't work well and does not detect all changes.
            // Instead, when we load "recorder.js", the first JS error is about "Object.assign" and "Array.from" being undefined.
            // Thus instead of MutationObserver, we look for this function and block recording if it's undefined.
            return
        }

        // We do not switch recorder versions midway through a recording.
        // do not start if explicitly disabled or if the user has opted out
        if (
            this._captureStarted ||
            this.instance.config.disable_session_recording ||
            this.instance.consent.isOptedOut()
        ) {
            return
        }

        this._captureStarted = true
        // We want to ensure the sessionManager is reset if necessary on load of the recorder
        this.sessionManager.checkAndGetSessionAndWindowId()

        // If recorder.js is already loaded (if array.full.js snippet is used or posthog-js/dist/recorder is
        // imported), don't load script. Otherwise, remotely import recorder.js from cdn since it hasn't been loaded.
        if (!this.rrwebRecord) {
            assignableWindow.__PosthogExtensions__?.loadExternalDependency?.(this.instance, this.scriptName, (err) => {
                if (err) {
                    return logger.error('could not load recorder', err)
                }

                this._onScriptLoaded()
            })
        } else {
            this._onScriptLoaded()
        }

        logger.info('starting')
        if (this.status === 'active') {
            this._reportStarted(startReason || 'recording_initialized')
        }
    }

    private get scriptName(): PostHogExtensionKind {
        return (
            (this.instance?.persistence?.get_property(SESSION_RECORDING_SCRIPT_CONFIG)
                ?.script as PostHogExtensionKind) || 'recorder'
        )
    }

    private isInteractiveEvent(event: eventWithTime) {
        return (
            event.type === INCREMENTAL_SNAPSHOT_EVENT_TYPE &&
            ACTIVE_SOURCES.indexOf(event.data?.source as IncrementalSource) !== -1
        )
    }

    private _updateWindowAndSessionIds(event: eventWithTime) {
        // Some recording events are triggered by non-user events (e.g. "X minutes ago" text updating on the screen).
        // We don't want to extend the session or trigger a new session in these cases. These events are designated by event
        // type -> incremental update, and source -> mutation.

        const isUserInteraction = this.isInteractiveEvent(event)

        if (!isUserInteraction && !this.isIdle) {
            // We check if the lastActivityTimestamp is old enough to go idle
            const timeSinceLastActivity = event.timestamp - this._lastActivityTimestamp
            if (timeSinceLastActivity > this.sessionIdleThresholdMilliseconds) {
                // we mark as idle right away,
                // or else we get multiple idle events
                // if there are lots of non-user activity events being emitted
                this.isIdle = true

                // don't take full snapshots while idle
                clearInterval(this._fullSnapshotTimer)

                this._tryAddCustomEvent('sessionIdle', {
                    eventTimestamp: event.timestamp,
                    lastActivityTimestamp: this._lastActivityTimestamp,
                    threshold: this.sessionIdleThresholdMilliseconds,
                    bufferLength: this.buffer.data.length,
                    bufferSize: this.buffer.size,
                })

                // proactively flush the buffer in case the session is idle for a long time
                this._flushBuffer()
            }
        }

        let returningFromIdle = false
        if (isUserInteraction) {
            this._lastActivityTimestamp = event.timestamp
            if (this.isIdle) {
                // Remove the idle state
                this.isIdle = false
                this._tryAddCustomEvent('sessionNoLongerIdle', {
                    reason: 'user activity',
                    type: event.type,
                })
                returningFromIdle = true
            }
        }

        if (this.isIdle) {
            return
        }

        // We only want to extend the session if it is an interactive event.
        const { windowId, sessionId } = this.sessionManager.checkAndGetSessionAndWindowId(
            !isUserInteraction,
            event.timestamp
        )

        const sessionIdChanged = this.sessionId !== sessionId
        const windowIdChanged = this.windowId !== windowId

        this.windowId = windowId
        this.sessionId = sessionId

        if (sessionIdChanged || windowIdChanged) {
            this.stopRecording()
            this.startIfEnabledOrStop('session_id_changed')
        } else if (returningFromIdle) {
            this._scheduleFullSnapshot()
        }
    }

    private _tryRRWebMethod(queuedRRWebEvent: QueuedRRWebEvent): boolean {
        try {
            queuedRRWebEvent.rrwebMethod()
            return true
        } catch (e) {
            // Sometimes a race can occur where the recorder is not fully started yet
            if (this.queuedRRWebEvents.length < 10) {
                this.queuedRRWebEvents.push({
                    enqueuedAt: queuedRRWebEvent.enqueuedAt || Date.now(),
                    attempt: queuedRRWebEvent.attempt++,
                    rrwebMethod: queuedRRWebEvent.rrwebMethod,
                })
            } else {
                logger.warn('could not emit queued rrweb event.', e, queuedRRWebEvent)
            }

            return false
        }
    }

    private _tryAddCustomEvent(tag: string, payload: any): boolean {
        return this._tryRRWebMethod(newQueuedEvent(() => this.rrwebRecord!.addCustomEvent(tag, payload)))
    }

    private _tryTakeFullSnapshot(): boolean {
        return this._tryRRWebMethod(newQueuedEvent(() => this.rrwebRecord!.takeFullSnapshot()))
    }

    private _onScriptLoaded() {
        // rrweb config info: https://github.com/rrweb-io/rrweb/blob/7d5d0033258d6c29599fb08412202d9a2c7b9413/src/record/index.ts#L28
        const sessionRecordingOptions: recordOptions = {
            // select set of rrweb config options we expose to our users
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

        // only allows user to set our allow-listed options
        const userSessionRecordingOptions = this.instance.config.session_recording
        for (const [key, value] of Object.entries(userSessionRecordingOptions || {})) {
            if (key in sessionRecordingOptions) {
                if (key === 'maskInputOptions') {
                    // ensure password is set if not included
                    sessionRecordingOptions.maskInputOptions = { password: true, ...value }
                } else {
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    sessionRecordingOptions[key] = value
                }
            }
        }

        if (this.canvasRecording && this.canvasRecording.enabled) {
            sessionRecordingOptions.recordCanvas = true
            sessionRecordingOptions.sampling = { canvas: this.canvasRecording.fps }
            sessionRecordingOptions.dataURLOptions = { type: 'image/webp', quality: this.canvasRecording.quality }
        }

        if (!this.rrwebRecord) {
            logger.error(
                'onScriptLoaded was called but rrwebRecord is not available. This indicates something has gone wrong.'
            )
            return
        }

        this.mutationRateLimiter =
            this.mutationRateLimiter ??
            new MutationRateLimiter(this.rrwebRecord, {
                refillRate: this.instance.config.session_recording.__mutationRateLimiterRefillRate,
                bucketSize: this.instance.config.session_recording.__mutationRateLimiterBucketSize,
                onBlockedNode: (id, node) => {
                    const message = `Too many mutations on node '${id}'. Rate limiting. This could be due to SVG animations or something similar`
                    logger.info(message, {
                        node: node,
                    })

                    this.log(LOGGER_PREFIX + ' ' + message, 'warn')
                },
            })

        const activePlugins = this._gatherRRWebPlugins()
        this.stopRrweb = this.rrwebRecord({
            emit: (event) => {
                this.onRRwebEmit(event)
            },
            plugins: activePlugins,
            ...sessionRecordingOptions,
        })

        // We reset the last activity timestamp, resetting the idle timer
        this._lastActivityTimestamp = Date.now()
        this.isIdle = false

        this._tryAddCustomEvent('$session_options', {
            sessionRecordingOptions,
            activePlugins: activePlugins.map((p) => p?.name),
        })

        this._tryAddCustomEvent('$posthog_config', {
            config: this.instance.config,
        })
    }

    private _scheduleFullSnapshot(): void {
        if (this._fullSnapshotTimer) {
            clearInterval(this._fullSnapshotTimer)
        }
        // we don't schedule snapshots while idle
        if (this.isIdle) {
            return
        }

        const interval = this.fullSnapshotIntervalMillis
        if (!interval) {
            return
        }

        this._fullSnapshotTimer = setInterval(() => {
            this._tryTakeFullSnapshot()
        }, interval)
    }

    private _gatherRRWebPlugins() {
        const plugins: RecordPlugin<unknown>[] = []

        const recordConsolePlugin = assignableWindow.__PosthogExtensions__?.rrwebPlugins?.getRecordConsolePlugin
        if (recordConsolePlugin && this.isConsoleLogCaptureEnabled) {
            plugins.push(recordConsolePlugin())
        }

        const networkPlugin = assignableWindow.__PosthogExtensions__?.rrwebPlugins?.getRecordNetworkPlugin
        if (this.networkPayloadCapture && isFunction(networkPlugin)) {
            const canRecordNetwork = !isLocalhost() || this._forceAllowLocalhostNetworkCapture

            if (canRecordNetwork) {
                plugins.push(
                    networkPlugin(buildNetworkRequestOptions(this.instance.config, this.networkPayloadCapture))
                )
            } else {
                logger.info('NetworkCapture not started because we are on localhost.')
            }
        }

        return plugins
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
        this._checkUrlTriggerConditions()

        if (this.status === 'paused' && !isRecordingPausedEvent(rawEvent)) {
            return
        }

        // we're processing a full snapshot, so we should reset the timer
        if (rawEvent.type === EventType.FullSnapshot) {
            this._scheduleFullSnapshot()
        }

        // Clear the buffer if waiting for a trigger, and only keep data from after the current full snapshot
        if (rawEvent.type === EventType.FullSnapshot && this.triggerStatus === 'trigger_pending') {
            this.clearBuffer()
        }

        const throttledEvent = this.mutationRateLimiter
            ? this.mutationRateLimiter.throttleMutations(rawEvent)
            : rawEvent

        if (!throttledEvent) {
            return
        }

        // TODO: Re-add ensureMaxMessageSize once we are confident in it
        const event = truncateLargeConsoleLogs(throttledEvent)

        this._updateWindowAndSessionIds(event)

        // When in an idle state we keep recording, but don't capture the events,
        if (this.isIdle && !isSessionIdleEvent(event)) {
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

        const eventToSend =
            (this.instance.config.session_recording.compress_events ?? true) ? compressEvent(event) : event
        const size = estimateSize(eventToSend)

        const properties = {
            $snapshot_bytes: size,
            $snapshot_data: eventToSend,
            $session_id: this.sessionId,
            $window_id: this.windowId,
        }

        if (this.status === 'disabled') {
            this.clearBuffer()
            return
        }

        this._captureSnapshotBuffered(properties)
    }

    private _pageViewFallBack() {
        if (this.instance.config.capture_pageview || !window) {
            return
        }
        const currentUrl = this._maskUrl(window.location.href)
        if (this._lastHref !== currentUrl) {
            this._tryAddCustomEvent('$url_changed', { href: currentUrl })
            this._lastHref = currentUrl
        }
    }

    private _processQueuedEvents() {
        if (this.queuedRRWebEvents.length) {
            // if rrweb isn't ready to accept events earlier then we queued them up
            // now that emit has been called rrweb should be ready to accept them
            // so, before we process this event, we try our queued events _once_ each
            // we don't want to risk queuing more things and never exiting this loop!
            // if they fail here, they'll be pushed into a new queue,
            // and tried on the next loop.
            // there is a risk of this queue growing in an uncontrolled manner,
            // so its length is limited elsewhere
            // for now this is to help us ensure we can capture events that happen
            // and try to identify more about when it is failing
            const itemsToProcess = [...this.queuedRRWebEvents]
            this.queuedRRWebEvents = []
            itemsToProcess.forEach((queuedRRWebEvent) => {
                if (Date.now() - queuedRRWebEvent.enqueuedAt <= TWO_SECONDS) {
                    this._tryRRWebMethod(queuedRRWebEvent)
                }
            })
        }
    }

    private _maskUrl(url: string): string | undefined {
        const userSessionRecordingOptions = this.instance.config.session_recording

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

    private clearBuffer(): SnapshotBuffer {
        this.buffer = {
            size: 0,
            data: [],
            sessionId: this.sessionId,
            windowId: this.windowId,
        }
        return this.buffer
    }

    private _flushBuffer(): SnapshotBuffer {
        if (this.flushBufferTimer) {
            clearTimeout(this.flushBufferTimer)
            this.flushBufferTimer = undefined
        }

        const minimumDuration = this.minimumDuration
        const sessionDuration = this.sessionDuration
        // if we have old data in the buffer but the session has rotated then the
        // session duration might be negative, in that case we want to flush the buffer
        const isPositiveSessionDuration = isNumber(sessionDuration) && sessionDuration >= 0
        const isBelowMinimumDuration =
            isNumber(minimumDuration) && isPositiveSessionDuration && sessionDuration < minimumDuration

        if (this.status === 'buffering' || isBelowMinimumDuration) {
            this.flushBufferTimer = setTimeout(() => {
                this._flushBuffer()
            }, RECORDING_BUFFER_TIMEOUT)
            return this.buffer
        }

        if (this.buffer.data.length > 0) {
            const snapshotEvents = splitBuffer(this.buffer)
            snapshotEvents.forEach((snapshotBuffer) => {
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
        return this.clearBuffer()
    }

    private _captureSnapshotBuffered(properties: Properties) {
        const additionalBytes = 2 + (this.buffer?.data.length || 0) // 2 bytes for the array brackets and 1 byte for each comma
        if (
            !this.isIdle && // we never want to flush when idle
            (this.buffer.size + properties.$snapshot_bytes + additionalBytes > RECORDING_MAX_EVENT_SIZE ||
                this.buffer.sessionId !== this.sessionId)
        ) {
            this.buffer = this._flushBuffer()
        }

        this.buffer.size += properties.$snapshot_bytes
        this.buffer.data.push(properties.$snapshot_data)

        if (!this.flushBufferTimer && !this.isIdle) {
            this.flushBufferTimer = setTimeout(() => {
                this._flushBuffer()
            }, RECORDING_BUFFER_TIMEOUT)
        }
    }

    private _captureSnapshot(properties: Properties) {
        // :TRICKY: Make sure we batch these requests, use a custom endpoint and don't truncate the strings.
        this.instance.capture('$snapshot', properties, {
            _url: this.instance.requestRouter.endpointFor('api', this._endpoint),
            _noTruncate: true,
            _batchKey: SESSION_RECORDING_BATCH_KEY,
            skip_client_rate_limiting: true,
        })
    }

    private _checkUrlTriggerConditions() {
        if (typeof window === 'undefined' || !window.location.href) {
            return
        }

        const url = window.location.href

        const wasBlocked = this.status === 'paused'
        const isNowBlocked = sessionRecordingUrlTriggerMatches(url, this._urlBlocklist)

        if (isNowBlocked && !wasBlocked) {
            this._pauseRecording()
        } else if (!isNowBlocked && wasBlocked) {
            this._resumeRecording()
        }

        if (sessionRecordingUrlTriggerMatches(url, this._urlTriggers)) {
            this._activateTrigger('url')
        }
    }

    private _activateTrigger(triggerType: TriggerType) {
        if (this.triggerStatus === 'trigger_pending') {
            // status is stored separately for URL and event triggers
            this.instance?.persistence?.register({
                [triggerType === 'url'
                    ? SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION
                    : SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION]: this.sessionId,
            })

            this._flushBuffer()
            this._reportStarted((triggerType + '_trigger_matched') as SessionStartReason)
        }
    }

    private _pauseRecording() {
        if (this.status === 'paused') {
            return
        }

        this._urlBlocked = true
        document?.body?.classList?.add('ph-no-capture')

        // Clear the snapshot timer since we don't want new snapshots while paused
        clearInterval(this._fullSnapshotTimer)

        // Running this in a timeout to ensure we can
        setTimeout(() => {
            this._flushBuffer()
        }, 100)

        logger.info('recording paused due to URL blocker')
        this._tryAddCustomEvent('recording paused', { reason: 'url blocker' })
    }

    private _resumeRecording() {
        if (this.status !== 'paused') {
            return
        }

        this._urlBlocked = false
        document?.body?.classList?.remove('ph-no-capture')

        this._tryTakeFullSnapshot()
        this._scheduleFullSnapshot()

        this._tryAddCustomEvent('recording resumed', { reason: 'left blocked url' })
        logger.info('recording resumed')
    }

    private _addEventTriggerListener() {
        if (this._eventTriggers.length === 0 || !isNullish(this._removeEventTriggerCaptureHook)) {
            return
        }

        this._removeEventTriggerCaptureHook = this.instance.on('eventCaptured', (event: CaptureResult) => {
            // If anything could go wrong here it has the potential to block the main loop,
            // so we catch all errors.
            try {
                if (this._eventTriggers.includes(event.event)) {
                    this._activateTrigger('event')
                }
            } catch (e) {
                logger.error('Could not activate event trigger', e)
            }
        })
    }

    /**
     * this ignores the linked flag config and (if other conditions are met) causes capture to start
     *
     * It is not usual to call this directly,
     * instead call `posthog.startSessionRecording({linked_flag: true})`
     * */
    public overrideLinkedFlag() {
        this._linkedFlagSeen = true
        this._reportStarted('linked_flag_overridden')
    }

    /**
     * this ignores the sampling config and (if other conditions are met) causes capture to start
     *
     * It is not usual to call this directly,
     * instead call `posthog.startSessionRecording({sampling: true})`
     * */
    public overrideSampling() {
        this.instance.persistence?.register({
            // short-circuits the `makeSamplingDecision` function in the session recording module
            [SESSION_RECORDING_IS_SAMPLED]: true,
        })
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

    private _reportStarted(startReason: SessionStartReason, tagPayload?: Record<string, any>) {
        this.instance.register_for_session({
            $session_recording_start_reason: startReason,
        })
        logger.info(startReason.replace('_', ' '), tagPayload)
        if (!includes(['recording_initialized', 'session_id_changed'], startReason)) {
            this._tryAddCustomEvent(startReason, tagPayload)
        }
    }
}
