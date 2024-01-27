import {
    CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE,
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

export const RECORDING_IDLE_ACTIVITY_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
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

export class SessionRecording {
    private instance: PostHog
    private _endpoint: string
    private flushBufferTimer?: any

    // we have a buffer - that contains PostHog snapshot events ready to be sent to the server
    private buffer?: SnapshotBuffer
    // and a queue - that contains rrweb events that we want to send to rrweb, but rrweb wasn't able to accept them yet
    private queuedRRWebEvents: QueuedRRWebEvent[] = []

    private mutationRateLimiter?: MutationRateLimiter
    private _captureStarted: boolean
    private stopRrweb: listenerHandler | undefined
    private receivedDecide: boolean
    private rrwebRecord: rrwebRecord | undefined
    private isIdle = false

    private _linkedFlagSeen: boolean = false
    private _lastActivityTimestamp: number = Date.now()
    private windowId: string | null = null
    private sessionId: string | null = null
    private _linkedFlag: string | null = null
    private _sampleRate: number | null = null
    private _minimumDuration: number | null = null
    private _recordCanvas: boolean = false
    private _canvasFps: number | null = null
    private _canvasQuality: number | null = null

    // Util to help developers working on this feature manually override
    _forceAllowLocalhostNetworkCapture = false

    public get started(): boolean {
        // TODO could we use status instead of _captureStarted?
        return this._captureStarted
    }

    private get sessionManager() {
        if (!this.instance.sessionManager) {
            logger.error('Session recording started without valid sessionManager')
            throw new Error('Session recording started without valid sessionManager. This is a bug.')
        }

        return this.instance.sessionManager
    }

    private get isSampled(): boolean | null {
        if (_isNumber(this._sampleRate)) {
            return this.instance.get_property(SESSION_RECORDING_IS_SAMPLED)
        } else {
            return null
        }
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

    private get recordingVersion() {
        const recordingVersion_server_side = this.instance.get_property(SESSION_RECORDING_RECORDER_VERSION_SERVER_SIDE)
        const recordingVersion_client_side = this.instance.config.session_recording?.recorderVersion
        return recordingVersion_client_side || recordingVersion_server_side || 'v1'
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

        if (_isString(this._linkedFlag) && !this._linkedFlagSeen) {
            return 'buffering'
        }

        if (_isBoolean(this.isSampled)) {
            return this.isSampled ? 'sampled' : 'disabled'
        } else {
            return 'active'
        }
    }

    constructor(instance: PostHog) {
        this.instance = instance
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

        if (!this.instance.sessionManager) {
            logger.error('Session recording started without valid sessionManager')
            throw new Error('Session recording started without valid sessionManager. This is a bug.')
        }

        this.buffer = this.clearBuffer()
    }

    startRecordingIfEnabled() {
        if (this.isRecordingEnabled) {
            this.startCaptureAndTrySendingQueuedSnapshots()
            logger.info('[SessionRecording] started')
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
            logger.info('[SessionRecording] stopped')
        }
    }

    private makeSamplingDecision(sessionId: string): void {
        const sessionIdChanged = this.sessionId !== sessionId

        if (!_isNumber(this._sampleRate)) {
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

        this.instance.persistence?.register({
            [SESSION_RECORDING_IS_SAMPLED]: shouldSample,
        })
    }

    afterDecideResponse(response: DecideResponse) {
        if (this.instance.persistence) {
            this.instance.persistence.register({
                [SESSION_RECORDING_ENABLED_SERVER_SIDE]: !!response['sessionRecording'],
                [CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE]: response.sessionRecording?.consoleLogRecordingEnabled,
                [SESSION_RECORDING_RECORDER_VERSION_SERVER_SIDE]: response.sessionRecording?.recorderVersion,
                [SESSION_RECORDING_NETWORK_PAYLOAD_CAPTURE]: {
                    capturePerformance: response.capturePerformance,
                    ...response.sessionRecording?.networkPayloadCapture,
                },
            })
        }

        const receivedSampleRate = response.sessionRecording?.sampleRate
        this._sampleRate =
            _isUndefined(receivedSampleRate) || _isNull(receivedSampleRate) ? null : parseFloat(receivedSampleRate)

        const receivedMinimumDuration = response.sessionRecording?.minimumDurationMilliseconds
        this._minimumDuration = _isUndefined(receivedMinimumDuration) ? null : receivedMinimumDuration

        const receivedRecordCanvas = response.sessionRecording?.recordCanvas
        this._recordCanvas =
            _isUndefined(receivedRecordCanvas) || _isNull(receivedRecordCanvas) ? false : receivedRecordCanvas

        const receivedCanvasFps = response.sessionRecording?.canvasFps
        this._canvasFps = _isUndefined(receivedCanvasFps) ? null : receivedCanvasFps

        const receivedCanvasQuality = response.sessionRecording?.canvasQuality
        this._canvasQuality =
            _isUndefined(receivedCanvasQuality) || _isNull(receivedCanvasQuality)
                ? null
                : parseFloat(receivedCanvasQuality)

        this._linkedFlag = response.sessionRecording?.linkedFlag || null

        if (response.sessionRecording?.endpoint) {
            this._endpoint = response.sessionRecording?.endpoint
        }

        if (_isNumber(this._sampleRate)) {
            this.sessionManager.onSessionId((sessionId) => {
                this.makeSamplingDecision(sessionId)
            })
        }

        if (_isString(this._linkedFlag)) {
            const linkedFlag = this._linkedFlag
            this.instance.onFeatureFlags((flags) => {
                this._linkedFlagSeen = flags.includes(linkedFlag)
            })
        }

        this.receivedDecide = true
        this.startRecordingIfEnabled()
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
            timestamp: _timestamp(),
        })
    }

    private startCaptureAndTrySendingQueuedSnapshots() {
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
        if (this._captureStarted || this.instance.config.disable_session_recording || userOptedOut(this.instance)) {
            return
        }

        this._captureStarted = true
        // We want to ensure the sessionManager is reset if necessary on load of the recorder
        this.sessionManager.checkAndGetSessionAndWindowId()

        const recorderJS = this.recordingVersion === 'v2' ? 'recorder-v2.js' : 'recorder.js'

        // If recorder.js is already loaded (if array.full.js snippet is used or posthog-js/dist/recorder is
        // imported) or matches the requested recorder version, don't load script. Otherwise, remotely import
        // recorder.js from cdn since it hasn't been loaded.
        if (this.instance.__loaded_recorder_version !== this.recordingVersion) {
            loadScript(this.instance.config.api_host + `/static/${recorderJS}?v=${Config.LIB_VERSION}`, (err) => {
                if (err) {
                    return logger.error(`Could not load ${recorderJS}`, err)
                }

                this._onScriptLoaded()
            })
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

        if (!isUserInteraction && !this.isIdle) {
            // We check if the lastActivityTimestamp is old enough to go idle
            if (event.timestamp - this._lastActivityTimestamp > RECORDING_IDLE_ACTIVITY_TIMEOUT_MS) {
                this.isIdle = true
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
            if (this.isIdle) {
                // Remove the idle state if set and trigger a full snapshot as we will have ignored previous mutations
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
            logger.error('[Session-Recording] could not emit queued rrweb event.', e)
            this.queuedRRWebEvents.length < 10 &&
                this.queuedRRWebEvents.push({
                    enqueuedAt: queuedRRWebEvent.enqueuedAt || Date.now(),
                    attempt: queuedRRWebEvent.attempt++,
                    rrwebMethod: queuedRRWebEvent.rrwebMethod,
                })
            return false
        }
    }

    private _tryAddCustomEvent(tag: string, payload: any): boolean {
        return this._tryRRWebMethod({
            // this should throw if rrwebRecord is not available
            rrwebMethod: () => {
                const rrwebRecord = this.rrwebRecord
                rrwebRecord!.addCustomEvent(tag, payload)
            },
            enqueuedAt: Date.now(),
            attempt: 0,
        })
    }

    private _tryTakeFullSnapshot(): boolean {
        return this._tryRRWebMethod({
            // this should throw if rrwebRecord is not available
            rrwebMethod: () => this.rrwebRecord?.takeFullSnapshot(),
            enqueuedAt: Date.now(),
            attempt: 0,
        })
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
        this.rrwebRecord = window.rrweb ? window.rrweb.record : window.rrwebRecord

        // only allows user to set our allow-listed options
        const userSessionRecordingOptions = this.instance.config.session_recording
        for (const [key, value] of Object.entries(userSessionRecordingOptions || {})) {
            if (key in sessionRecordingOptions) {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                sessionRecordingOptions[key] = value
            }
        }

        if (this._recordCanvas && !_isNull(this._canvasFps) && !_isNull(this._canvasQuality)) {
            sessionRecordingOptions.recordCanvas = true
            sessionRecordingOptions.sampling = { canvas: this._canvasFps }
            sessionRecordingOptions.dataURLOptions = { type: 'image/webp', quality: this._canvasQuality }
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
                onBlockedNode: (id, node) => {
                    const message = `Too many mutations on node '${id}'. Rate limiting. This could be due to SVG animations or something similar`
                    logger.info(message, {
                        node: node,
                    })

                    this.log('[PostHog Recorder] ' + message, 'warn')
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
    }

    private _gatherRRWebPlugins() {
        const plugins: RecordPlugin<unknown>[] = []

        if (assignableWindow.rrwebConsoleRecord && this.isConsoleLogCaptureEnabled) {
            plugins.push(assignableWindow.rrwebConsoleRecord.getRecordConsolePlugin())
        }

        if (this.networkPayloadCapture && _isFunction(assignableWindow.getRecordNetworkPlugin)) {
            const canRecordNetwork = !isLocalhost() || this._forceAllowLocalhostNetworkCapture

            if (canRecordNetwork) {
                plugins.push(
                    assignableWindow.getRecordNetworkPlugin(
                        buildNetworkRequestOptions(this.instance.config, this.networkPayloadCapture)
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

        const throttledEvent = this.mutationRateLimiter
            ? this.mutationRateLimiter.throttleMutations(rawEvent)
            : rawEvent

        if (!throttledEvent) {
            return
        }

        // TODO: Re-add ensureMaxMessageSize once we are confident in it
        const event = truncateLargeConsoleLogs(throttledEvent)
        const size = JSON.stringify(event).length

        this._updateWindowAndSessionIds(event)

        if (this.isIdle) {
            // When in an idle state we keep recording, but don't capture the events
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
                if (Date.now() - queuedRRWebEvent.enqueuedAt > 2000) {
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
        this.buffer = undefined

        return {
            size: 0,
            data: [],
            sessionId: this.sessionId,
            windowId: this.windowId,
        }
    }

    // the intention is a buffer that (currently) is used only after a decide response enables session recording
    // it is called ever X seconds using the flushBufferTimer so that we don't have to wait for the buffer to fill up
    // when it is called on a timer it assumes that it can definitely flush
    // it is flushed when the session id changes or the size of the buffered data gets too great (1mb by default)
    // first change: if the recording is in buffering mode,
    //  flush buffer simply resets the timer and returns the existing flush buffer
    private _flushBuffer() {
        if (this.flushBufferTimer) {
            clearTimeout(this.flushBufferTimer)
            this.flushBufferTimer = undefined
        }

        const minimumDuration = this._minimumDuration
        const sessionDuration = this.sessionDuration
        // if we have old data in the buffer but the session has rotated then the
        // session duration might be negative, in that case we want to flush the buffer
        const isPositiveSessionDuration = _isNumber(sessionDuration) && sessionDuration >= 0
        const isBelowMinimumDuration =
            _isNumber(minimumDuration) && isPositiveSessionDuration && sessionDuration < minimumDuration

        if (this.status === 'buffering' || isBelowMinimumDuration) {
            this.flushBufferTimer = setTimeout(() => {
                this._flushBuffer()
            }, RECORDING_BUFFER_TIMEOUT)
            return this.buffer || this.clearBuffer()
        }

        if (this.buffer && this.buffer.data.length !== 0) {
            this._captureSnapshot({
                $snapshot_bytes: this.buffer.size,
                $snapshot_data: this.buffer.data,
                $session_id: this.buffer.sessionId,
                $window_id: this.buffer.windowId,
            })

            return this.clearBuffer()
        } else {
            return this.buffer || this.clearBuffer()
        }
    }

    private _captureSnapshotBuffered(properties: Properties) {
        const additionalBytes = 2 + (this.buffer?.data.length || 0) // 2 bytes for the array brackets and 1 byte for each comma
        if (
            !this.buffer ||
            this.buffer.size + properties.$snapshot_bytes + additionalBytes > RECORDING_MAX_EVENT_SIZE ||
            (!!this.buffer.sessionId && this.buffer.sessionId !== this.sessionId)
        ) {
            this.buffer = this._flushBuffer()
        }

        if (_isNull(this.buffer.sessionId) && !_isNull(this.sessionId)) {
            // session id starts null but has now been assigned, update the buffer
            this.buffer.sessionId = this.sessionId
            this.buffer.windowId = this.windowId
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
            transport: 'XHR',
            method: 'POST',
            endpoint: this._endpoint,
            _noTruncate: true,
            _batchKey: SESSION_RECORDING_BATCH_KEY,
            _metrics: {
                rrweb_full_snapshot: properties.$snapshot_data.type === FULL_SNAPSHOT_EVENT_TYPE,
            },
        })
    }
}
