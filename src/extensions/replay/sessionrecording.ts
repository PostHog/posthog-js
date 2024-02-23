import {
    CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_RECORDING_CANVAS_RECORDING,
    SESSION_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_RECORDING_IS_SAMPLED,
    SESSION_RECORDING_NETWORK_PAYLOAD_CAPTURE,
    SESSION_RECORDING_RECORDER_VERSION_SERVER_SIDE,
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
import { DecideResponse, NetworkRecordOptions, NetworkRequest, Properties } from '../../types'
import { EventType, type eventWithTime, type listenerHandler, RecordPlugin } from '@rrweb/types'
import Config from '../../config'
import { _timestamp, loadScript } from '../../utils'

import { _isBoolean, _isFunction, _isNull, _isNumber, _isObject, _isString, _isUndefined } from '../../utils/type-utils'
import { logger } from '../../utils/logger'
import { assignableWindow, window } from '../../utils/globals'
import { buildNetworkRequestOptions } from './config'
import { isLocalhost } from '../../utils/request-utils'
import { userOptedOut } from '../../gdpr-utils'

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
    sessionId: string | null
    windowId: string | null
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

export class SessionRecording {
    private _instance: PostHog
    private _endpoint: string
    private _flushBufferTimer?: any

    // we have a buffer - that contains PostHog snapshot events ready to be sent to the server
    private _buffer?: SnapshotBuffer
    // and a queue - that contains rrweb events that we want to send to rrweb, but rrweb wasn't able to accept them yet
    private _queuedRRWebEvents: QueuedRRWebEvent[] = []

    private _mutationRateLimiter?: MutationRateLimiter
    private _captureStarted: boolean
    private _stopRrweb: listenerHandler | undefined
    private _receivedDecide: boolean
    private _rrwebRecord: rrwebRecord | undefined
    private _isIdle = false

    private _linkedFlagSeen: boolean = false
    private _lastActivityTimestamp: number = Date.now()
    private _windowId: string | null = null
    private _sessionId: string | null = null
    private _linkedFlag: string | null = null
    private _sampleRate: number | null = null
    private _minimumDuration: number | null = null

    private _fullSnapshotTimer?: number

    // Util to help developers working on this feature manually override
    _forceAllowLocalhostNetworkCapture = false

    public get started(): boolean {
        // TODO could we use status instead of _captureStarted?
        return this._captureStarted
    }

    private get _sessionManager() {
        if (!this._instance.sessionManager) {
            logger.error('Session recording started without valid sessionManager')
            throw new Error('Session recording started without valid sessionManager. This is a bug.')
        }

        return this._instance.sessionManager
    }

    private get _isSampled(): boolean | null {
        if (_isNumber(this._sampleRate)) {
            return this._instance.get_property(SESSION_RECORDING_IS_SAMPLED)
        } else {
            return null
        }
    }

    private get _sessionDuration(): number | null {
        const mostRecentSnapshot = this._buffer?.data[this._buffer?.data.length - 1]
        const { sessionStartTimestamp } = this._sessionManager.checkAndGetSessionAndWindowId(true)
        return mostRecentSnapshot ? mostRecentSnapshot.timestamp - sessionStartTimestamp : null
    }

    private get _isRecordingEnabled() {
        const enabled_server_side = !!this._instance.get_property(SESSION_RECORDING_ENABLED_SERVER_SIDE)
        const enabled_client_side = !this._instance.config.disable_session_recording
        return window && enabled_server_side && enabled_client_side
    }

    private get _isConsoleLogCaptureEnabled() {
        const enabled_server_side = !!this._instance.get_property(CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE)
        const enabled_client_side = this._instance.config.enable_recording_console_log
        return enabled_client_side ?? enabled_server_side
    }

    private get _canvasRecording(): { enabled: boolean; fps: number; quality: number } | undefined {
        const canvasRecording_server_side = this._instance.get_property(SESSION_RECORDING_CANVAS_RECORDING)
        return canvasRecording_server_side && canvasRecording_server_side.fps && canvasRecording_server_side.quality
            ? {
                  enabled: canvasRecording_server_side.enabled,
                  fps: canvasRecording_server_side.fps,
                  quality: canvasRecording_server_side.quality,
              }
            : undefined
    }

    private get _recordingVersion() {
        const recordingVersion_server_side = this._instance.get_property(SESSION_RECORDING_RECORDER_VERSION_SERVER_SIDE)
        const recordingVersion_client_side = this._instance.config.session_recording?.recorderVersion
        return recordingVersion_client_side || recordingVersion_server_side || 'v1'
    }

    // network payload capture config has three parts
    // each can be configured server side or client side
    private get _networkPayloadCapture():
        | Pick<NetworkRecordOptions, 'recordHeaders' | 'recordBody' | 'recordPerformance'>
        | undefined {
        const networkPayloadCapture_server_side = this._instance.get_property(SESSION_RECORDING_NETWORK_PAYLOAD_CAPTURE)
        const networkPayloadCapture_client_side = {
            recordHeaders: this._instance.config.session_recording?.recordHeaders,
            recordBody: this._instance.config.session_recording?.recordBody,
        }
        const headersEnabled =
            networkPayloadCapture_client_side?.recordHeaders || networkPayloadCapture_server_side?.recordHeaders
        const bodyEnabled =
            networkPayloadCapture_client_side?.recordBody || networkPayloadCapture_server_side?.recordBody
        const performanceEnabled =
            this._instance.config.capture_performance || networkPayloadCapture_server_side?.capturePerformance

        return headersEnabled || bodyEnabled || performanceEnabled
            ? { recordHeaders: headersEnabled, recordBody: bodyEnabled, recordPerformance: performanceEnabled }
            : undefined
    }

    /**
     * defaults to buffering mode until a decide response is received
     * once a decide response is received status can be disabled, active or sampled
     */
    private get _status(): SessionRecordingStatus {
        if (!this._receivedDecide) {
            return 'buffering'
        }

        if (!this._isRecordingEnabled) {
            return 'disabled'
        }

        if (_isString(this._linkedFlag) && !this._linkedFlagSeen) {
            return 'buffering'
        }

        if (_isBoolean(this._isSampled)) {
            return this._isSampled ? 'sampled' : 'disabled'
        } else {
            return 'active'
        }
    }

    constructor(instance: PostHog) {
        this._instance = instance
        this._captureStarted = false
        this._endpoint = BASE_ENDPOINT
        this._stopRrweb = undefined
        this._receivedDecide = false

        window?.addEventListener('beforeunload', () => {
            this._flushBuffer()
        })

        window?.addEventListener('offline', () => {
            this._tryAddCustomEvent('browser offline', {})
        })

        window?.addEventListener('online', () => {
            this._tryAddCustomEvent('browser online', {})
        })

        if (!this._instance.sessionManager) {
            logger.error('Session recording started without valid sessionManager')
            throw new Error('Session recording started without valid sessionManager. This is a bug.')
        }

        this._buffer = this._clearBuffer()
    }

    startRecordingIfEnabled() {
        if (this._isRecordingEnabled) {
            this._startCaptureAndTrySendingQueuedSnapshots()
            logger.info('[SessionRecording] started')
        } else {
            this.stopRecording()
            this._clearBuffer()
        }
    }

    stopRecording() {
        if (this._captureStarted && this._stopRrweb) {
            this._stopRrweb()
            this._stopRrweb = undefined
            this._captureStarted = false
            logger.info('[SessionRecording] stopped')
        }
    }

    private _makeSamplingDecision(sessionId: string): void {
        const sessionIdChanged = this._sessionId !== sessionId

        if (!_isNumber(this._sampleRate)) {
            this._instance.persistence?.register({
                [SESSION_RECORDING_IS_SAMPLED]: null,
            })
            return
        }

        const storedIsSampled = this._isSampled

        /**
         * if we get this far then we should make a sampling decision.
         * When the session id changes or there is no stored sampling decision for this session id
         * then we should make a new decision.
         *
         * Otherwise, we should use the stored decision.
         */
        let shouldSample: boolean
        if (sessionIdChanged || !_isBoolean(storedIsSampled)) {
            const randomNumber = Math.random()
            shouldSample = randomNumber < this._sampleRate
        } else {
            shouldSample = storedIsSampled
        }

        if (!shouldSample) {
            logger.warn(
                `[SessionSampling] Sample rate (${this._sampleRate}) has determined that this sessionId (${sessionId}) will not be sent to the server.`
            )
        }

        this._instance.persistence?.register({
            [SESSION_RECORDING_IS_SAMPLED]: shouldSample,
        })
    }

    afterDecideResponse(response: DecideResponse) {
        if (this._instance.persistence) {
            this._instance.persistence.register({
                [SESSION_RECORDING_ENABLED_SERVER_SIDE]: !!response['sessionRecording'],
                [CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE]: response.sessionRecording?.consoleLogRecordingEnabled,
                [SESSION_RECORDING_RECORDER_VERSION_SERVER_SIDE]: response.sessionRecording?.recorderVersion,
                [SESSION_RECORDING_NETWORK_PAYLOAD_CAPTURE]: {
                    capturePerformance: response.capturePerformance,
                    ...response.sessionRecording?.networkPayloadCapture,
                },
                [SESSION_RECORDING_CANVAS_RECORDING]: {
                    enabled: response.sessionRecording?.recordCanvas,
                    fps: response.sessionRecording?.canvasFps,
                    quality: response.sessionRecording?.canvasQuality,
                },
            })
        }

        const receivedSampleRate = response.sessionRecording?.sampleRate
        this._sampleRate =
            _isUndefined(receivedSampleRate) || _isNull(receivedSampleRate) ? null : parseFloat(receivedSampleRate)

        const receivedMinimumDuration = response.sessionRecording?.minimumDurationMilliseconds
        this._minimumDuration = _isUndefined(receivedMinimumDuration) ? null : receivedMinimumDuration

        this._linkedFlag = response.sessionRecording?.linkedFlag || null

        if (response.sessionRecording?.endpoint) {
            this._endpoint = response.sessionRecording?.endpoint
        }

        if (_isNumber(this._sampleRate)) {
            this._sessionManager.onSessionId((sessionId) => {
                this._makeSamplingDecision(sessionId)
            })
        }

        if (_isString(this._linkedFlag)) {
            const linkedFlag = this._linkedFlag
            this._instance.onFeatureFlags((flags) => {
                this._linkedFlagSeen = flags.includes(linkedFlag)
            })
        }

        this._receivedDecide = true
        this.startRecordingIfEnabled()
    }

    log(message: string, level: 'log' | 'warn' | 'error' = 'log') {
        this._instance.sessionRecording?.onRRwebEmit({
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
            timestamp: _timestamp(),
        })
    }

    private _startCaptureAndTrySendingQueuedSnapshots() {
        this._startCapture()
    }

    private _startCapture() {
        if (_isUndefined(Object.assign)) {
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
        if (this._captureStarted || this._instance.config.disable_session_recording || userOptedOut(this._instance)) {
            return
        }

        this._captureStarted = true
        // We want to ensure the sessionManager is reset if necessary on load of the recorder
        this._sessionManager.checkAndGetSessionAndWindowId()

        const recorderJS = this._recordingVersion === 'v2' ? 'recorder-v2.js' : 'recorder.js'

        // If recorder.js is already loaded (if array.full.js snippet is used or posthog-js/dist/recorder is
        // imported) or matches the requested recorder version, don't load script. Otherwise, remotely import
        // recorder.js from cdn since it hasn't been loaded.
        if (this._instance.__loaded_recorder_version !== this._recordingVersion) {
            loadScript(
                this._instance.requestRouter.endpointFor('assets', `/static/${recorderJS}?v=${Config.LIB_VERSION}`),
                (err) => {
                    if (err) {
                        return logger.error(`Could not load ${recorderJS}`, err)
                    }

                    this._onScriptLoaded()
                }
            )
        } else {
            this._onScriptLoaded()
        }
    }

    private _isInteractiveEvent(event: eventWithTime) {
        return event.type === INCREMENTAL_SNAPSHOT_EVENT_TYPE && ACTIVE_SOURCES.indexOf(event.data?.source) !== -1
    }

    private _updateWindowAndSessionIds(event: eventWithTime) {
        // Some recording events are triggered by non-user events (e.g. "X minutes ago" text updating on the screen).
        // We don't want to extend the session or trigger a new session in these cases. These events are designated by event
        // type -> incremental update, and source -> mutation.

        const isUserInteraction = this._isInteractiveEvent(event)

        if (!isUserInteraction && !this._isIdle) {
            // We check if the lastActivityTimestamp is old enough to go idle
            if (event.timestamp - this._lastActivityTimestamp > RECORDING_IDLE_ACTIVITY_TIMEOUT_MS) {
                this._isIdle = true
                this._tryAddCustomEvent('sessionIdle', {
                    reason: 'user inactivity',
                    timeSinceLastActive: event.timestamp - this._lastActivityTimestamp,
                    threshold: RECORDING_IDLE_ACTIVITY_TIMEOUT_MS,
                })
            }
        }

        let returningFromIdle = false
        if (isUserInteraction) {
            this._lastActivityTimestamp = event.timestamp
            if (this._isIdle) {
                // Remove the idle state if set and trigger a full snapshot as we will have ignored previous mutations
                this._isIdle = false
                this._tryAddCustomEvent('sessionNoLongerIdle', {
                    reason: 'user activity',
                    type: event.type,
                })
                returningFromIdle = true
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

        if (
            returningFromIdle ||
            ([FULL_SNAPSHOT_EVENT_TYPE, META_EVENT_TYPE].indexOf(event.type) === -1 &&
                (windowIdChanged || sessionIdChanged))
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
            logger.warn('[Session-Recording] could not emit queued rrweb event.', e)
            this._queuedRRWebEvents.length < 10 &&
                this._queuedRRWebEvents.push({
                    enqueuedAt: queuedRRWebEvent.enqueuedAt || Date.now(),
                    attempt: queuedRRWebEvent.attempt++,
                    rrwebMethod: queuedRRWebEvent.rrwebMethod,
                })
            return false
        }
    }

    private _tryAddCustomEvent(tag: string, payload: any): boolean {
        return this._tryRRWebMethod(newQueuedEvent(() => this._rrwebRecord!.addCustomEvent(tag, payload)))
    }

    private _tryTakeFullSnapshot(): boolean {
        return this._tryRRWebMethod(newQueuedEvent(() => this._rrwebRecord!.takeFullSnapshot()))
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
        // We switched from loading all of rrweb to just the record part, but
        // keep backwards compatibility if someone hasn't upgraded PostHog
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this._rrwebRecord = window.rrweb ? window.rrweb.record : window.rrwebRecord

        // only allows user to set our allow-listed options
        const userSessionRecordingOptions = this._instance.config.session_recording
        for (const [key, value] of Object.entries(userSessionRecordingOptions || {})) {
            if (key in sessionRecordingOptions) {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                sessionRecordingOptions[key] = value
            }
        }

        if (this._canvasRecording && this._canvasRecording.enabled) {
            sessionRecordingOptions.recordCanvas = true
            sessionRecordingOptions.sampling = { canvas: this._canvasRecording.fps }
            sessionRecordingOptions.dataURLOptions = { type: 'image/webp', quality: this._canvasRecording.quality }
        }

        if (!this._rrwebRecord) {
            logger.error(
                'onScriptLoaded was called but rrwebRecord is not available. This indicates something has gone wrong.'
            )
            return
        }

        this._mutationRateLimiter =
            this._mutationRateLimiter ??
            new MutationRateLimiter(this._rrwebRecord, {
                onBlockedNode: (id, node) => {
                    const message = `Too many mutations on node '${id}'. Rate limiting. This could be due to SVG animations or something similar`
                    logger.info(message, {
                        node: node,
                    })

                    this.log('[PostHog Recorder] ' + message, 'warn')
                },
            })

        // rrweb takes a snapshot on initialization,
        // we want to take one in five minutes
        // if nothing else happens to reset the timer
        this._scheduleFullSnapshot()

        const activePlugins = this._gatherRRWebPlugins()
        this._stopRrweb = this._rrwebRecord({
            emit: (event) => {
                this.onRRwebEmit(event)
            },
            plugins: activePlugins,
            ...sessionRecordingOptions,
        })

        // :TRICKY: rrweb does not capture navigation within SPA-s, so hook into our $pageview events to get access to all events.
        //   Dropping the initial event is fine (it's always captured by rrweb).
        this._instance._addCaptureHook((eventName) => {
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
        this._isIdle = false

        this._tryAddCustomEvent('$session_options', {
            sessionRecordingOptions,
            activePlugins: activePlugins.map((p) => p?.name),
        })

        this._tryAddCustomEvent('$posthog_config', {
            config: this._instance.config,
        })
    }

    private _scheduleFullSnapshot(): void {
        if (this._fullSnapshotTimer) {
            clearInterval(this._fullSnapshotTimer)
        }

        this._fullSnapshotTimer = setInterval(() => {
            this._tryTakeFullSnapshot()
        }, FIVE_MINUTES) // 5 minutes
    }

    private _gatherRRWebPlugins() {
        const plugins: RecordPlugin<unknown>[] = []

        if (assignableWindow.rrwebConsoleRecord && this._isConsoleLogCaptureEnabled) {
            plugins.push(assignableWindow.rrwebConsoleRecord.getRecordConsolePlugin())
        }

        if (this._networkPayloadCapture && _isFunction(assignableWindow.getRecordNetworkPlugin)) {
            const canRecordNetwork = !isLocalhost() || this._forceAllowLocalhostNetworkCapture

            if (canRecordNetwork) {
                plugins.push(
                    assignableWindow.getRecordNetworkPlugin(
                        buildNetworkRequestOptions(this._instance.config, this._networkPayloadCapture)
                    )
                )
            } else {
                logger.info('[SessionReplay-NetworkCapture] not started because we are on localhost.')
            }
        }

        return plugins
    }

    onRRwebEmit(rawEvent: eventWithTime) {
        this._processQueuedEvents()

        if (!rawEvent || !_isObject(rawEvent)) {
            return
        }

        if (rawEvent.type === EventType.Meta) {
            const href = this._maskUrl(rawEvent.data.href)
            if (!href) {
                return
            }
            rawEvent.data.href = href
        }

        if (rawEvent.type === EventType.FullSnapshot) {
            // we're processing a full snapshot, so we should reset the timer
            this._scheduleFullSnapshot()
        }

        const throttledEvent = this._mutationRateLimiter
            ? this._mutationRateLimiter.throttleMutations(rawEvent)
            : rawEvent

        if (!throttledEvent) {
            return
        }

        // TODO: Re-add ensureMaxMessageSize once we are confident in it
        const event = truncateLargeConsoleLogs(throttledEvent)
        const size = JSON.stringify(event).length

        this._updateWindowAndSessionIds(event)

        // allow custom events even when idle
        if (this._isIdle && event.type !== EventType.Custom) {
            // When in an idle state we keep recording, but don't capture the events
            return
        }

        const properties = {
            $snapshot_bytes: size,
            $snapshot_data: event,
            $session_id: this._sessionId,
            $window_id: this._windowId,
        }

        if (this._status !== 'disabled') {
            this._captureSnapshotBuffered(properties)
        } else {
            this._clearBuffer()
        }
    }

    private _processQueuedEvents() {
        if (this._queuedRRWebEvents.length) {
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
            const itemsToProcess = [...this._queuedRRWebEvents]
            this._queuedRRWebEvents = []
            itemsToProcess.forEach((queuedRRWebEvent) => {
                if (Date.now() - queuedRRWebEvent.enqueuedAt > TWO_SECONDS) {
                    this._tryAddCustomEvent('rrwebQueueTimeout', {
                        enqueuedAt: queuedRRWebEvent.enqueuedAt,
                        attempt: queuedRRWebEvent.attempt,
                        queueLength: itemsToProcess.length,
                    })
                } else {
                    if (this._tryRRWebMethod(queuedRRWebEvent)) {
                        this._tryAddCustomEvent('rrwebQueueSuccess', {
                            enqueuedAt: queuedRRWebEvent.enqueuedAt,
                            attempt: queuedRRWebEvent.attempt,
                            queueLength: itemsToProcess.length,
                        })
                    }
                }
            })
        }
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

    private _clearBuffer(): SnapshotBuffer {
        this._buffer = undefined

        return {
            size: 0,
            data: [],
            sessionId: this._sessionId,
            windowId: this._windowId,
        }
    }

    // the intention is a buffer that (currently) is used only after a decide response enables session recording
    // it is called ever X seconds using the flushBufferTimer so that we don't have to wait for the buffer to fill up
    // when it is called on a timer it assumes that it can definitely flush
    // it is flushed when the session id changes or the size of the buffered data gets too great (1mb by default)
    // first change: if the recording is in buffering mode,
    //  flush buffer simply resets the timer and returns the existing flush buffer
    private _flushBuffer() {
        if (this._flushBufferTimer) {
            clearTimeout(this._flushBufferTimer)
            this._flushBufferTimer = undefined
        }

        const minimumDuration = this._minimumDuration
        const sessionDuration = this._sessionDuration
        // if we have old data in the buffer but the session has rotated then the
        // session duration might be negative, in that case we want to flush the buffer
        const isPositiveSessionDuration = _isNumber(sessionDuration) && sessionDuration >= 0
        const isBelowMinimumDuration =
            _isNumber(minimumDuration) && isPositiveSessionDuration && sessionDuration < minimumDuration

        if (this._status === 'buffering' || isBelowMinimumDuration) {
            this._flushBufferTimer = setTimeout(() => {
                this._flushBuffer()
            }, RECORDING_BUFFER_TIMEOUT)
            return this._buffer || this._clearBuffer()
        }

        if (this._buffer && this._buffer.data.length !== 0) {
            this._captureSnapshot({
                $snapshot_bytes: this._buffer.size,
                $snapshot_data: this._buffer.data,
                $session_id: this._buffer.sessionId,
                $window_id: this._buffer.windowId,
            })

            return this._clearBuffer()
        } else {
            return this._buffer || this._clearBuffer()
        }
    }

    private _captureSnapshotBuffered(properties: Properties) {
        const additionalBytes = 2 + (this._buffer?.data.length || 0) // 2 bytes for the array brackets and 1 byte for each comma
        if (
            !this._buffer ||
            this._buffer.size + properties.$snapshot_bytes + additionalBytes > RECORDING_MAX_EVENT_SIZE ||
            (!!this._buffer.sessionId && this._buffer.sessionId !== this._sessionId)
        ) {
            this._buffer = this._flushBuffer()
        }

        if (_isNull(this._buffer.sessionId) && !_isNull(this._sessionId)) {
            // session id starts null but has now been assigned, update the buffer
            this._buffer.sessionId = this._sessionId
            this._buffer.windowId = this._windowId
        }

        this._buffer.size += properties.$snapshot_bytes
        this._buffer.data.push(properties.$snapshot_data)

        if (!this._flushBufferTimer) {
            this._flushBufferTimer = setTimeout(() => {
                this._flushBuffer()
            }, RECORDING_BUFFER_TIMEOUT)
        }
    }

    private _captureSnapshot(properties: Properties) {
        // :TRICKY: Make sure we batch these requests, use a custom endpoint and don't truncate the strings.
        this._instance.capture('$snapshot', properties, {
            method: 'POST',
            _url: this._instance.requestRouter.endpointFor('api', this._endpoint),
            _noTruncate: true,
            _batchKey: SESSION_RECORDING_BATCH_KEY,
            _metrics: {
                rrweb_full_snapshot: properties.$snapshot_data.type === FULL_SNAPSHOT_EVENT_TYPE,
            },
        })
    }
}
