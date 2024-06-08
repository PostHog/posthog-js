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
    MutationRateLimiter,
    recordOptions,
    rrwebRecord,
    truncateLargeConsoleLogs,
} from './sessionrecording-utils'
import { PostHog } from '../../posthog-core'
import { DecideResponse, FlagVariant, NetworkRecordOptions, NetworkRequest, Properties } from '../../types'
import { EventType, type eventWithTime, type listenerHandler, RecordPlugin } from '@rrweb/types'
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

// Copied from rrweb typings to avoid import
enum IncrementalSource {
    Mutation = 0,
    MouseMove = 1,
    MouseInteraction = 2,
    Scroll = 3,
    ViewportResize = 4,
    Input = 5,
    TouchMove = 6,
    MediaInteraction = 7,
    StyleSheetRule = 8,
    CanvasMutation = 9,
    Font = 10,
    Log = 11,
    Drag = 12,
    StyleDeclaration = 13,
    Selection = 14,
    AdoptedStyleSheet = 15,
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

    readonly mostRecentSnapshotTimestamp: number | null
    add(properties: Properties): void
}

class InMemoryBuffer implements SnapshotBuffer {
    size: number
    data: any[]
    sessionId: string
    windowId: string

    get mostRecentSnapshotTimestamp(): number | null {
        return this.data.length ? this.data[this.data.length - 1].timestamp : null
    }

    constructor(sessionId: string, windowId: string) {
        this.size = 0
        this.data = []
        this.sessionId = sessionId
        this.windowId = windowId
    }

    add(properties: Properties) {
        this.size += properties.$snapshot_bytes
        this.data.push(properties.$snapshot_data)
    }
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

export class SessionRecording {
    private __endpoint: string
    private __flushBufferTimer?: any

    // we have a buffer - that contains PostHog snapshot events ready to be sent to the server
    private __buffer: SnapshotBuffer
    // and a queue - that contains rrweb events that we want to send to rrweb, but rrweb wasn't able to accept them yet
    private __queuedRRWebEvents: QueuedRRWebEvent[] = []

    private __mutationRateLimiter?: MutationRateLimiter
    private __captureStarted: boolean
    private __stopRrweb: listenerHandler | undefined
    private __receivedDecide: boolean
    private __isIdle = false

    private __linkedFlagSeen: boolean = false
    private __lastActivityTimestamp: number = Date.now()
    private __windowId: string
    private __sessionId: string
    private __linkedFlag: string | FlagVariant | null = null

    private __fullSnapshotTimer?: ReturnType<typeof setInterval>

    // if pageview capture is disabled
    // then we can manually track href changes
    private __lastHref?: string

    // Util to help developers working on this feature manually override
    _forceAllowLocalhostNetworkCapture = false

    private get __rrwebRecord(): rrwebRecord | undefined {
        return assignableWindow?.rrweb?.record
    }

    public get started(): boolean {
        // TODO could we use status instead of _captureStarted?
        return this.__captureStarted
    }

    private get __sessionManager() {
        if (!this.instance.sessionManager) {
            throw new Error(LOGGER_PREFIX + ' started without valid sessionManager. This is a bug.')
        }

        return this.instance.sessionManager
    }

    private get __isSampled(): boolean | null {
        const currentValue = this.instance.get_property(SESSION_RECORDING_IS_SAMPLED)
        return isBoolean(currentValue) ? currentValue : null
    }

    private get __sessionDuration(): number | null {
        const mostRecentSnapshotTimestamp = this.__buffer.mostRecentSnapshotTimestamp
        const { sessionStartTimestamp } = this.__sessionManager.checkAndGetSessionAndWindowId(true)
        return mostRecentSnapshotTimestamp ? mostRecentSnapshotTimestamp - sessionStartTimestamp : null
    }

    private get __isRecordingEnabled() {
        const enabled_server_side = !!this.instance.get_property(SESSION_RECORDING_ENABLED_SERVER_SIDE)
        const enabled_client_side = !this.instance.config.disable_session_recording
        return window && enabled_server_side && enabled_client_side
    }

    private get __isConsoleLogCaptureEnabled() {
        const enabled_server_side = !!this.instance.get_property(CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE)
        const enabled_client_side = this.instance.config.enable_recording_console_log
        return enabled_client_side ?? enabled_server_side
    }

    private get __canvasRecording(): { enabled: boolean; fps: number; quality: number } | undefined {
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
    private get __networkPayloadCapture():
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

    private get __sampleRate(): number | null {
        const rate = this.instance.get_property(SESSION_RECORDING_SAMPLE_RATE)
        return isNumber(rate) ? rate : null
    }

    private get __minimumDuration(): number | null {
        const duration = this.instance.get_property(SESSION_RECORDING_MINIMUM_DURATION)
        return isNumber(duration) ? duration : null
    }

    /**
     * defaults to buffering mode until a decide response is received
     * once a decide response is received status can be disabled, active or sampled
     */
    private get __status(): SessionRecordingStatus {
        if (!this.__receivedDecide) {
            return 'buffering'
        }

        if (!this.__isRecordingEnabled) {
            return 'disabled'
        }

        if (!isNullish(this.__linkedFlag) && !this.__linkedFlagSeen) {
            return 'buffering'
        }

        if (isBoolean(this.__isSampled)) {
            return this.__isSampled ? 'sampled' : 'disabled'
        } else {
            return 'active'
        }
    }

    constructor(private readonly instance: PostHog) {
        this.__captureStarted = false
        this.__endpoint = BASE_ENDPOINT
        this.__stopRrweb = undefined
        this.__receivedDecide = false

        window?.addEventListener('beforeunload', () => {
            this.__flushBuffer()
        })

        window?.addEventListener('offline', () => {
            this.__tryAddCustomEvent('browser offline', {})
        })

        window?.addEventListener('online', () => {
            this.__tryAddCustomEvent('browser online', {})
        })

        window?.addEventListener('visibilitychange', () => {
            if (document?.visibilityState) {
                const label = 'window ' + document.visibilityState
                this.__tryAddCustomEvent(label, {})
            }
        })

        if (!this.instance.sessionManager) {
            logger.error(LOGGER_PREFIX + ' started without valid sessionManager')
            throw new Error(LOGGER_PREFIX + ' started without valid sessionManager. This is a bug.')
        }

        // we know there's a sessionManager, so don't need to start without a session id
        const { sessionId, windowId } = this.__sessionManager.checkAndGetSessionAndWindowId()
        this.__sessionId = sessionId
        this.__windowId = windowId

        this.__buffer = new InMemoryBuffer(this.__sessionId, this.__windowId)

        // on reload there might be an already sampled session that should be continued before decide response,
        // so we call this here _and_ in the decide response
        this.__setupSampling()
    }

    startIfEnabledOrStop() {
        if (this.__isRecordingEnabled) {
            this.__startCapture()
            logger.info(LOGGER_PREFIX + ' started')
        } else {
            this.stopRecording()
            this.__clearBuffer()
        }
    }

    stopRecording() {
        if (this.__captureStarted && this.__stopRrweb) {
            this.__stopRrweb()
            this.__stopRrweb = undefined
            this.__captureStarted = false
            logger.info(LOGGER_PREFIX + ' stopped')
        }
    }

    private __makeSamplingDecision(sessionId: string): void {
        const sessionIdChanged = this.__sessionId !== sessionId

        // capture the current sample rate,
        // because it is re-used multiple times
        // and the bundler won't minimise any of the references
        const currentSampleRate = this.__sampleRate

        if (!isNumber(currentSampleRate)) {
            this.instance.persistence?.register({
                [SESSION_RECORDING_IS_SAMPLED]: null,
            })
            return
        }

        const storedIsSampled = this.__isSampled

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
        this.__tryAddCustomEvent('samplingDecisionMade', {
            sampleRate: currentSampleRate,
        })

        this.instance.persistence?.register({
            [SESSION_RECORDING_IS_SAMPLED]: shouldSample,
        })
    }

    afterDecideResponse(response: DecideResponse) {
        this.__persistDecideResponse(response)

        this.__linkedFlag = response.sessionRecording?.linkedFlag || null

        if (response.sessionRecording?.endpoint) {
            this.__endpoint = response.sessionRecording?.endpoint
        }

        this.__setupSampling()

        if (!isNullish(this.__linkedFlag)) {
            const linkedFlag = isString(this.__linkedFlag) ? this.__linkedFlag : this.__linkedFlag.flag
            const linkedVariant = isString(this.__linkedFlag) ? null : this.__linkedFlag.variant
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
                    this.__tryAddCustomEvent(tag, payload)
                }
                this.__linkedFlagSeen = linkedFlagMatches
            })
        }

        this.__receivedDecide = true
        this.startIfEnabledOrStop()
    }

    private __samplingSessionListener: (() => void) | null = null

    /**
     * This might be called more than once so needs to be idempotent
     */
    private __setupSampling() {
        if (isNumber(this.__sampleRate) && isNull(this.__samplingSessionListener)) {
            this.__samplingSessionListener = this.__sessionManager.onSessionId((sessionId) => {
                this.__makeSamplingDecision(sessionId)
            })
        }
    }

    private __persistDecideResponse(response: DecideResponse): void {
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
            this.__sessionManager.onSessionId(persistResponse)
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

    private __startCapture() {
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
            this.__captureStarted ||
            this.instance.config.disable_session_recording ||
            this.instance.consent.isOptedOut()
        ) {
            return
        }

        this.__captureStarted = true
        // We want to ensure the sessionManager is reset if necessary on load of the recorder
        this.__sessionManager.checkAndGetSessionAndWindowId()

        // If recorder.js is already loaded (if array.full.js snippet is used or posthog-js/dist/recorder is
        // imported), don't load script. Otherwise, remotely import recorder.js from cdn since it hasn't been loaded.
        if (!this.__rrwebRecord) {
            loadScript(
                this.instance.requestRouter.endpointFor('assets', `/static/recorder.js?v=${Config.LIB_VERSION}`),
                (err) => {
                    if (err) {
                        return logger.error(LOGGER_PREFIX + ` could not load recorder.js`, err)
                    }

                    this.__onScriptLoaded()
                }
            )
        } else {
            this.__onScriptLoaded()
        }
    }

    private __isInteractiveEvent(event: eventWithTime) {
        return (
            event.type === INCREMENTAL_SNAPSHOT_EVENT_TYPE &&
            ACTIVE_SOURCES.indexOf(event.data?.source as IncrementalSource) !== -1
        )
    }

    private __updateWindowAndSessionIds(event: eventWithTime) {
        // Some recording events are triggered by non-user events (e.g. "X minutes ago" text updating on the screen).
        // We don't want to extend the session or trigger a new session in these cases. These events are designated by event
        // type -> incremental update, and source -> mutation.

        const isUserInteraction = this.__isInteractiveEvent(event)

        if (!isUserInteraction && !this.__isIdle) {
            // We check if the lastActivityTimestamp is old enough to go idle
            if (event.timestamp - this.__lastActivityTimestamp > RECORDING_IDLE_ACTIVITY_TIMEOUT_MS) {
                this.__isIdle = true
                this.__tryAddCustomEvent('sessionIdle', {
                    reason: 'user inactivity',
                    timeSinceLastActive: event.timestamp - this.__lastActivityTimestamp,
                    threshold: RECORDING_IDLE_ACTIVITY_TIMEOUT_MS,
                })
                // don't take full snapshots while idle
                clearTimeout(this.__fullSnapshotTimer)
                // proactively flush the buffer in case the session is idle for a long time
                this.__flushBuffer()
            }
        }

        let returningFromIdle = false
        if (isUserInteraction) {
            this.__lastActivityTimestamp = event.timestamp
            if (this.__isIdle) {
                // Remove the idle state if set and trigger a full snapshot as we will have ignored previous mutations
                this.__isIdle = false
                this.__tryAddCustomEvent('sessionNoLongerIdle', {
                    reason: 'user activity',
                    type: event.type,
                })
                returningFromIdle = true
            }
        }

        if (this.__isIdle) {
            return
        }

        // We only want to extend the session if it is an interactive event.
        const { windowId, sessionId } = this.__sessionManager.checkAndGetSessionAndWindowId(
            !isUserInteraction,
            event.timestamp
        )

        const sessionIdChanged = this.__sessionId !== sessionId
        const windowIdChanged = this.__windowId !== windowId

        this.__windowId = windowId
        this.__sessionId = sessionId

        if (
            returningFromIdle ||
            ([FULL_SNAPSHOT_EVENT_TYPE, META_EVENT_TYPE].indexOf(event.type) === -1 &&
                (windowIdChanged || sessionIdChanged || isUndefined(this.__fullSnapshotTimer)))
        ) {
            this.__tryTakeFullSnapshot()
        }
    }

    private __tryRRWebMethod(queuedRRWebEvent: QueuedRRWebEvent): boolean {
        try {
            queuedRRWebEvent.rrwebMethod()
            return true
        } catch (e) {
            // Sometimes a race can occur where the recorder is not fully started yet
            if (this.__queuedRRWebEvents.length < 10) {
                this.__queuedRRWebEvents.push({
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

    private __tryAddCustomEvent(tag: string, payload: any): boolean {
        return this.__tryRRWebMethod(newQueuedEvent(() => this.__rrwebRecord!.addCustomEvent(tag, payload)))
    }

    private __tryTakeFullSnapshot(): boolean {
        return this.__tryRRWebMethod(newQueuedEvent(() => this.__rrwebRecord!.takeFullSnapshot()))
    }

    private __onScriptLoaded() {
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

        if (this.__canvasRecording && this.__canvasRecording.enabled) {
            sessionRecordingOptions.recordCanvas = true
            sessionRecordingOptions.sampling = { canvas: this.__canvasRecording.fps }
            sessionRecordingOptions.dataURLOptions = { type: 'image/webp', quality: this.__canvasRecording.quality }
        }

        if (!this.__rrwebRecord) {
            logger.error(
                LOGGER_PREFIX +
                    'onScriptLoaded was called but rrwebRecord is not available. This indicates something has gone wrong.'
            )
            return
        }

        this.__mutationRateLimiter =
            this.__mutationRateLimiter ??
            new MutationRateLimiter(this.__rrwebRecord, {
                onBlockedNode: (id, node) => {
                    const message = `Too many mutations on node '${id}'. Rate limiting. This could be due to SVG animations or something similar`
                    logger.info(message, {
                        node: node,
                    })

                    this.log(LOGGER_PREFIX + ' ' + message, 'warn')
                },
            })

        const activePlugins = this.__gatherRRWebPlugins()
        this.__stopRrweb = this.__rrwebRecord({
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
                    const href = window ? this.__maskUrl(window.location.href) : ''
                    if (!href) {
                        return
                    }
                    this.__tryAddCustomEvent('$pageview', { href })
                    this.__tryTakeFullSnapshot()
                }
            } catch (e) {
                logger.error('Could not add $pageview to rrweb session', e)
            }
        })

        // We reset the last activity timestamp, resetting the idle timer
        this.__lastActivityTimestamp = Date.now()
        this.__isIdle = false

        this.__tryAddCustomEvent('$session_options', {
            sessionRecordingOptions,
            activePlugins: activePlugins.map((p) => p?.name),
        })

        this.__tryAddCustomEvent('$posthog_config', {
            config: this.instance.config,
        })
    }

    private __scheduleFullSnapshot(): void {
        if (this.__fullSnapshotTimer) {
            clearInterval(this.__fullSnapshotTimer)
        }

        this.__fullSnapshotTimer = setInterval(() => {
            this.__tryTakeFullSnapshot()
        }, FIVE_MINUTES) // 5 minutes
    }

    private __gatherRRWebPlugins() {
        const plugins: RecordPlugin<unknown>[] = []

        if (assignableWindow.rrwebConsoleRecord && this.__isConsoleLogCaptureEnabled) {
            plugins.push(assignableWindow.rrwebConsoleRecord.getRecordConsolePlugin())
        }

        if (this.__networkPayloadCapture && isFunction(assignableWindow.getRecordNetworkPlugin)) {
            const canRecordNetwork = !isLocalhost() || this._forceAllowLocalhostNetworkCapture

            if (canRecordNetwork) {
                plugins.push(
                    assignableWindow.getRecordNetworkPlugin(
                        buildNetworkRequestOptions(this.instance.config, this.__networkPayloadCapture)
                    )
                )
            } else {
                logger.info(LOGGER_PREFIX + ' NetworkCapture not started because we are on localhost.')
            }
        }

        return plugins
    }

    onRRwebEmit(rawEvent: eventWithTime) {
        this.__processQueuedEvents()

        if (!rawEvent || !isObject(rawEvent)) {
            return
        }

        if (rawEvent.type === EventType.Meta) {
            const href = this.__maskUrl(rawEvent.data.href)
            this.__lastHref = href
            if (!href) {
                return
            }
            rawEvent.data.href = href
        } else {
            this.__pageViewFallBack()
        }

        if (rawEvent.type === EventType.FullSnapshot) {
            // we're processing a full snapshot, so we should reset the timer
            this.__scheduleFullSnapshot()
        }

        const throttledEvent = this.__mutationRateLimiter
            ? this.__mutationRateLimiter.throttleMutations(rawEvent)
            : rawEvent

        if (!throttledEvent) {
            return
        }

        // TODO: Re-add ensureMaxMessageSize once we are confident in it
        const event = truncateLargeConsoleLogs(throttledEvent)
        const size = JSON.stringify(event).length

        this.__updateWindowAndSessionIds(event)

        // allow custom events even when idle
        if (this.__isIdle && event.type !== EventType.Custom) {
            // When in an idle state we keep recording, but don't capture the events
            return
        }

        const properties = {
            $snapshot_bytes: size,
            $snapshot_data: event,
            $session_id: this.__sessionId,
            $window_id: this.__windowId,
        }

        if (this.__status !== 'disabled') {
            this.__captureSnapshotBuffered(properties)
        } else {
            this.__clearBuffer()
        }
    }

    private __pageViewFallBack() {
        if (this.instance.config.capture_pageview || !window) {
            return
        }
        const currentUrl = this.__maskUrl(window.location.href)
        if (this.__lastHref !== currentUrl) {
            this.__tryAddCustomEvent('$url_changed', { href: currentUrl })
            this.__lastHref = currentUrl
        }
    }

    private __processQueuedEvents() {
        if (this.__queuedRRWebEvents.length) {
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
            const itemsToProcess = [...this.__queuedRRWebEvents]
            this.__queuedRRWebEvents = []
            itemsToProcess.forEach((queuedRRWebEvent) => {
                if (Date.now() - queuedRRWebEvent.enqueuedAt > TWO_SECONDS) {
                    this.__tryAddCustomEvent('rrwebQueueTimeout', {
                        enqueuedAt: queuedRRWebEvent.enqueuedAt,
                        attempt: queuedRRWebEvent.attempt,
                        queueLength: itemsToProcess.length,
                    })
                } else {
                    if (this.__tryRRWebMethod(queuedRRWebEvent)) {
                        this.__tryAddCustomEvent('rrwebQueueSuccess', {
                            enqueuedAt: queuedRRWebEvent.enqueuedAt,
                            attempt: queuedRRWebEvent.attempt,
                            queueLength: itemsToProcess.length,
                        })
                    }
                }
            })
        }
    }

    private __maskUrl(url: string): string | undefined {
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

    private __clearBuffer(): void {
        this.__buffer = new InMemoryBuffer(this.__sessionId, this.__windowId)
    }

    private __flushBuffer(): void {
        if (this.__flushBufferTimer) {
            clearTimeout(this.__flushBufferTimer)
            this.__flushBufferTimer = undefined
        }

        const minimumDuration = this.__minimumDuration
        const sessionDuration = this.__sessionDuration
        // if we have old data in the buffer but the session has rotated then the
        // session duration might be negative, in that case we want to flush the buffer
        const isPositiveSessionDuration = isNumber(sessionDuration) && sessionDuration >= 0
        const isBelowMinimumDuration =
            isNumber(minimumDuration) && isPositiveSessionDuration && sessionDuration < minimumDuration

        if (this.__status === 'buffering' || isBelowMinimumDuration) {
            this.__flushBufferTimer = setTimeout(() => {
                this.__flushBuffer()
            }, RECORDING_BUFFER_TIMEOUT)

            return
        }

        if (this.__buffer.data.length > 0) {
            this.__captureSnapshot({
                $snapshot_bytes: this.__buffer.size,
                $snapshot_data: this.__buffer.data,
                $session_id: this.__buffer.sessionId,
                $window_id: this.__buffer.windowId,
            })
        }
        this.__clearBuffer()
    }

    private __captureSnapshotBuffered(properties: Properties) {
        const additionalBytes = 2 + (this.__buffer?.data.length || 0) // 2 bytes for the array brackets and 1 byte for each comma
        if (
            this.__buffer.size + properties.$snapshot_bytes + additionalBytes > RECORDING_MAX_EVENT_SIZE ||
            this.__buffer.sessionId !== this.__sessionId
        ) {
            this.__flushBuffer()
        }

        this.__buffer.add(properties)
        if (!this.__flushBufferTimer) {
            this.__flushBufferTimer = setTimeout(() => {
                this.__flushBuffer()
            }, RECORDING_BUFFER_TIMEOUT)
        }
    }

    private __captureSnapshot(properties: Properties) {
        // :TRICKY: Make sure we batch these requests, use a custom endpoint and don't truncate the strings.
        this.instance.capture('$snapshot', properties, {
            _url: this.instance.requestRouter.endpointFor('api', this.__endpoint),
            _noTruncate: true,
            _batchKey: SESSION_RECORDING_BATCH_KEY,
            _noHeatmaps: true, // Session Replay ingestion can't handle heatamap data
        })
    }
}
