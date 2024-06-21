import {
    CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_RECORDING_CANVAS_RECORDING,
    SESSION_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_RECORDING_IS_SAMPLED,
    SESSION_RECORDING_MINIMUM_DURATION,
    SESSION_RECORDING_NETWORK_PAYLOAD_CAPTURE,
    SESSION_RECORDING_SAMPLE_RATE,
} from '../../constants'
import {
    FULL_SNAPSHOT_EVENT_TYPE,
    INCREMENTAL_SNAPSHOT_EVENT_TYPE,
    META_EVENT_TYPE,
    recordOptions,
    rrwebRecord,
    truncateLargeConsoleLogs,
} from './sessionrecording-utils'
import { PostHog } from '../../posthog-core'
import { DecideResponse, FlagVariant, NetworkRecordOptions, NetworkRequest, Properties } from '../../types'
import { EventType, type eventWithTime, IncrementalSource, type listenerHandler, RecordPlugin } from '@rrweb/types'
import Config from '../../config'
import { timestamp, loadScript } from '../../utils'

import {
    isBoolean,
    isFunction,
    isNull,
    isNullish,
    isNumber,
    isObject,
    isString,
    isUndefined,
} from '../../utils/type-utils'
import { logger } from '../../utils/logger'
import { document, assignableWindow, window } from '../../utils/globals'
import { buildNetworkRequestOptions } from './config'
import { isLocalhost } from '../../utils/request-utils'
import { MutationRateLimiter } from './mutation-rate-limiter'

const BASE_ENDPOINT = '/s/'

const FIVE_MINUTES = 1000 * 60 * 5
const TWO_SECONDS = 2000
export const RECORDING_IDLE_ACTIVITY_TIMEOUT_MS = FIVE_MINUTES
export const RECORDING_MAX_EVENT_SIZE = 1024 * 1024 * 0.9 // ~1mb (with some wiggle room)
export const RECORDING_BUFFER_TIMEOUT = 2000 // 2 seconds
export const SESSION_RECORDING_BATCH_KEY = 'recordings'

// NOTE: Importing this type is problematic as we can't safely bundle it to a TS definition so, instead we redefine.
// import type { record } from 'rrweb2/typings'
// import type { recordOptions } from 'rrweb/typings/types'

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

/**
 * Session recording starts in buffering mode while waiting for decide response
 * Once the response is received it might be disabled, active or sampled
 * When sampled that means a sample rate is set and the last time the session id was rotated
 * the sample rate determined this session should be sent to the server.
 */
type SessionRecordingStatus = 'disabled' | 'sampled' | 'active' | 'buffering'

interface SnapshotBuffer {
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

const newQueuedEvent = (rrwebMethod: () => void): QueuedRRWebEvent => ({
    rrwebMethod,
    enqueuedAt: Date.now(),
    attempt: 1,
})

const LOGGER_PREFIX = '[SessionRecording]'

// taken from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Cyclic_object_value#circular_references
function circularReferenceReplacer() {
    const ancestors: any[] = []
    return function (_key: string, value: any) {
        if (isObject(value)) {
            // `this` is the object that value is contained in,
            // i.e., its direct parent.
            // @ts-expect-error - TS was unhappy with `this` on the next line but the code is copied in from MDN
            while (ancestors.length > 0 && ancestors.at(-1) !== this) {
                ancestors.pop()
            }
            if (ancestors.includes(value)) {
                return '[Circular]'
            }
            ancestors.push(value)
            return value
        } else {
            return value
        }
    }
}

function estimateSize(event: eventWithTime): number {
    return JSON.stringify(event, circularReferenceReplacer()).length
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

    // if pageview capture is disabled
    // then we can manually track href changes
    private _lastHref?: string

    // Util to help developers working on this feature manually override
    _forceAllowLocalhostNetworkCapture = false

    private get rrwebRecord(): rrwebRecord | undefined {
        return assignableWindow?.rrweb?.record
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
        return this.instance.config.session_recording?.full_snapshot_interval_millis || FIVE_MINUTES
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

    private get canvasRecording(): { enabled: boolean; fps: number; quality: number } | undefined {
        const canvasRecording_server_side = this.instance.get_property(SESSION_RECORDING_CANVAS_RECORDING)
        return canvasRecording_server_side && canvasRecording_server_side.fps && canvasRecording_server_side.quality
            ? {
                  enabled: canvasRecording_server_side.enabled,
                  fps: canvasRecording_server_side.fps,
                  quality: canvasRecording_server_side.quality,
              }
            : undefined
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
        const performanceEnabled =
            this.instance.config.capture_performance || networkPayloadCapture_server_side?.capturePerformance

        return headersEnabled || bodyEnabled || performanceEnabled
            ? { recordHeaders: headersEnabled, recordBody: bodyEnabled, recordPerformance: performanceEnabled }
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
    private get status(): SessionRecordingStatus {
        if (!this.receivedDecide) {
            return 'buffering'
        }

        if (!this.isRecordingEnabled) {
            return 'disabled'
        }

        if (!isNullish(this._linkedFlag) && !this._linkedFlagSeen) {
            return 'buffering'
        }

        if (isBoolean(this.isSampled)) {
            return this.isSampled ? 'sampled' : 'disabled'
        } else {
            return 'active'
        }
    }

    constructor(private readonly instance: PostHog) {
        this._captureStarted = false
        this._endpoint = BASE_ENDPOINT
        this.stopRrweb = undefined
        this.receivedDecide = false

        window?.addEventListener('beforeunload', () => {
            this._flushBuffer()
        })

        window?.addEventListener('offline', () => {
            this._tryAddCustomEvent('browser offline', {})
        })

        window?.addEventListener('online', () => {
            this._tryAddCustomEvent('browser online', {})
        })

        window?.addEventListener('visibilitychange', () => {
            if (document?.visibilityState) {
                const label = 'window ' + document.visibilityState
                this._tryAddCustomEvent(label, {})
            }
        })

        if (!this.instance.sessionManager) {
            logger.error(LOGGER_PREFIX + ' started without valid sessionManager')
            throw new Error(LOGGER_PREFIX + ' started without valid sessionManager. This is a bug.')
        }

        // we know there's a sessionManager, so don't need to start without a session id
        const { sessionId, windowId } = this.sessionManager.checkAndGetSessionAndWindowId()
        this.sessionId = sessionId
        this.windowId = windowId

        this.buffer = this.clearBuffer()

        // on reload there might be an already sampled session that should be continued before decide response,
        // so we call this here _and_ in the decide response
        this._setupSampling()
    }

    startIfEnabledOrStop() {
        if (this.isRecordingEnabled) {
            this._startCapture()
            logger.info(LOGGER_PREFIX + ' started')
        } else {
            this.stopRecording()
            this.clearBuffer()
        }
    }

    stopRecording() {
        if (this._captureStarted && this.stopRrweb) {
            this.stopRrweb()
            this.stopRrweb = undefined
            this._captureStarted = false
            logger.info(LOGGER_PREFIX + ' stopped')
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

        if (!shouldSample && makeDecision) {
            logger.warn(
                LOGGER_PREFIX +
                    ` Sample rate (${currentSampleRate}) has determined that this sessionId (${sessionId}) will not be sent to the server.`
            )
        }
        this._tryAddCustomEvent('samplingDecisionMade', {
            sampleRate: currentSampleRate,
        })

        this.instance.persistence?.register({
            [SESSION_RECORDING_IS_SAMPLED]: shouldSample,
        })
    }

    afterDecideResponse(response: DecideResponse) {
        this._persistDecideResponse(response)

        this._linkedFlag = response.sessionRecording?.linkedFlag || null

        if (response.sessionRecording?.endpoint) {
            this._endpoint = response.sessionRecording?.endpoint
        }

        this._setupSampling()

        if (!isNullish(this._linkedFlag)) {
            const linkedFlag = isString(this._linkedFlag) ? this._linkedFlag : this._linkedFlag.flag
            const linkedVariant = isString(this._linkedFlag) ? null : this._linkedFlag.variant
            this.instance.onFeatureFlags((_flags, variants) => {
                const flagIsPresent = isObject(variants) && linkedFlag in variants
                const linkedFlagMatches = linkedVariant ? variants[linkedFlag] === linkedVariant : flagIsPresent
                if (linkedFlagMatches) {
                    const payload = {
                        linkedFlag,
                        linkedVariant,
                    }
                    const tag = 'linked flag matched'
                    logger.info(LOGGER_PREFIX + ' ' + tag, payload)
                    this._tryAddCustomEvent(tag, payload)
                }
                this._linkedFlagSeen = linkedFlagMatches
            })
        }

        this.receivedDecide = true
        this.startIfEnabledOrStop()
    }

    private _samplingSessionListener: (() => void) | null = null

    /**
     * This might be called more than once so needs to be idempotent
     */
    private _setupSampling() {
        if (isNumber(this.sampleRate) && isNull(this._samplingSessionListener)) {
            this._samplingSessionListener = this.sessionManager.onSessionId((sessionId) => {
                this.makeSamplingDecision(sessionId)
            })
        }
    }

    private _persistDecideResponse(response: DecideResponse): void {
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
                })
            }

            persistResponse()
            this.sessionManager.onSessionId(persistResponse)
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
            timestamp: timestamp(),
        })
    }

    private _startCapture() {
        if (isUndefined(Object.assign)) {
            // According to the rrweb docs, rrweb is not supported on IE11 and below:
            // "rrweb does not support IE11 and below because it uses the MutationObserver API which was supported by these browsers."
            // https://github.com/rrweb-io/rrweb/blob/master/guide.md#compatibility-note
            //
            // However, MutationObserver does exist on IE11, it just doesn't work well and does not detect all changes.
            // Instead, when we load "recorder.js", the first JS error is about "Object.assign" being undefined.
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
            loadScript(
                this.instance.requestRouter.endpointFor('assets', `/static/recorder.js?v=${Config.LIB_VERSION}`),
                (err) => {
                    if (err) {
                        return logger.error(LOGGER_PREFIX + ` could not load recorder.js`, err)
                    }

                    this._onScriptLoaded()
                }
            )
        } else {
            this._onScriptLoaded()
        }
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
            if (event.timestamp - this._lastActivityTimestamp > RECORDING_IDLE_ACTIVITY_TIMEOUT_MS) {
                this.isIdle = true
                // don't take full snapshots while idle
                clearTimeout(this._fullSnapshotTimer)
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

        if (
            returningFromIdle ||
            ([FULL_SNAPSHOT_EVENT_TYPE, META_EVENT_TYPE].indexOf(event.type) === -1 &&
                (windowIdChanged || sessionIdChanged || isUndefined(this._fullSnapshotTimer)))
        ) {
            this._tryTakeFullSnapshot()
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
                logger.warn(LOGGER_PREFIX + ' could not emit queued rrweb event.', e, queuedRRWebEvent)
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
        const sessionRecordingOptions: recordOptions<eventWithTime> = {
            // select set of rrweb config options we expose to our users
            // see https://github.com/rrweb-io/rrweb/blob/master/guide.md
            blockClass: 'ph-no-capture',
            blockSelector: undefined,
            ignoreClass: 'ph-ignore-input',
            maskTextClass: 'ph-mask',
            maskTextSelector: undefined,
            maskTextFn: undefined,
            maskAllInputs: true,
            maskInputOptions: {},
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
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                sessionRecordingOptions[key] = value
            }
        }

        if (this.canvasRecording && this.canvasRecording.enabled) {
            sessionRecordingOptions.recordCanvas = true
            sessionRecordingOptions.sampling = { canvas: this.canvasRecording.fps }
            sessionRecordingOptions.dataURLOptions = { type: 'image/webp', quality: this.canvasRecording.quality }
        }

        if (!this.rrwebRecord) {
            logger.error(
                LOGGER_PREFIX +
                    'onScriptLoaded was called but rrwebRecord is not available. This indicates something has gone wrong.'
            )
            return
        }

        this.mutationRateLimiter =
            this.mutationRateLimiter ??
            new MutationRateLimiter(this.rrwebRecord, {
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

        // :TRICKY: rrweb does not capture navigation within SPA-s, so hook into our $pageview events to get access to all events.
        //   Dropping the initial event is fine (it's always captured by rrweb).
        this.instance._addCaptureHook((eventName) => {
            // If anything could go wrong here it has the potential to block the main loop,
            // so we catch all errors.
            try {
                if (eventName === '$pageview') {
                    const href = window ? this._maskUrl(window.location.href) : ''
                    if (!href) {
                        return
                    }
                    this._tryAddCustomEvent('$pageview', { href })
                    this._tryTakeFullSnapshot()
                }
            } catch (e) {
                logger.error('Could not add $pageview to rrweb session', e)
            }
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

        if (assignableWindow.rrwebConsoleRecord && this.isConsoleLogCaptureEnabled) {
            plugins.push(assignableWindow.rrwebConsoleRecord.getRecordConsolePlugin())
        }

        if (this.networkPayloadCapture && isFunction(assignableWindow.getRecordNetworkPlugin)) {
            const canRecordNetwork = !isLocalhost() || this._forceAllowLocalhostNetworkCapture

            if (canRecordNetwork) {
                plugins.push(
                    assignableWindow.getRecordNetworkPlugin(
                        buildNetworkRequestOptions(this.instance.config, this.networkPayloadCapture)
                    )
                )
            } else {
                logger.info(LOGGER_PREFIX + ' NetworkCapture not started because we are on localhost.')
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

        // we're processing a full snapshot, so we should reset the timer
        if (rawEvent.type === EventType.FullSnapshot) {
            this._scheduleFullSnapshot()
        }

        const throttledEvent = this.mutationRateLimiter
            ? this.mutationRateLimiter.throttleMutations(rawEvent)
            : rawEvent

        if (!throttledEvent) {
            return
        }

        // TODO: Re-add ensureMaxMessageSize once we are confident in it
        const event = truncateLargeConsoleLogs(throttledEvent)
        const size = estimateSize(event)

        this._updateWindowAndSessionIds(event)

        // When in an idle state we keep recording, but don't capture the events
        // bu we allow custom events even when idle
        if (this.isIdle && event.type !== EventType.Custom) {
            return
        }

        const properties = {
            $snapshot_bytes: size,
            $snapshot_data: event,
            $session_id: this.sessionId,
            $window_id: this.windowId,
        }

        if (this.status !== 'disabled') {
            this._captureSnapshotBuffered(properties)
        } else {
            this.clearBuffer()
        }
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
            this._captureSnapshot({
                $snapshot_bytes: this.buffer.size,
                $snapshot_data: this.buffer.data,
                $session_id: this.buffer.sessionId,
                $window_id: this.buffer.windowId,
            })
        }

        // buffer is empty, we clear it in case the session id has changed
        return this.clearBuffer()
    }

    private _captureSnapshotBuffered(properties: Properties) {
        const additionalBytes = 2 + (this.buffer?.data.length || 0) // 2 bytes for the array brackets and 1 byte for each comma
        if (
            this.buffer.size + properties.$snapshot_bytes + additionalBytes > RECORDING_MAX_EVENT_SIZE ||
            this.buffer.sessionId !== this.sessionId
        ) {
            this.buffer = this._flushBuffer()
        }

        this.buffer.size += properties.$snapshot_bytes
        this.buffer.data.push(properties.$snapshot_data)

        if (!this.flushBufferTimer) {
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
            _noHeatmaps: true, // Session Replay ingestion can't handle heatamap data
        })
    }
}
