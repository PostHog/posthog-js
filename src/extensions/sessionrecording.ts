import {
    CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_RECORDING_RECORDER_VERSION_SERVER_SIDE,
} from '../constants'
import {
    ensureMaxMessageSize,
    FULL_SNAPSHOT_EVENT_TYPE,
    INCREMENTAL_SNAPSHOT_EVENT_TYPE,
    META_EVENT_TYPE,
    MutationRateLimiter,
    recordOptions,
    rrwebRecord,
    truncateLargeConsoleLogs,
} from './sessionrecording-utils'
import { PostHog } from '../posthog-core'
import { DecideResponse, Properties } from '../types'
import type { eventWithTime, listenerHandler } from '@rrweb/types'
import Config from '../config'
import { logger, loadScript, _timestamp } from '../utils'

const BASE_ENDPOINT = '/s/'

export const RECORDING_IDLE_ACTIVITY_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
export const RECORDING_MAX_EVENT_SIZE = 1024 * 1024 * 0.9 // ~1mb (with some wiggle room)
export const RECORDING_BUFFER_TIMEOUT = 2000 // 2 seconds
export const SESSION_RECORDING_BATCH_KEY = 'sessionRecording'

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

export class SessionRecording {
    private instance: PostHog
    private emit: boolean
    private endpoint: string
    private windowId: string | null
    private sessionId: string | null
    private lastActivityTimestamp: number = Date.now()
    private flushBufferTimer?: any
    private buffer?: {
        size: number
        data: any[]
        sessionId: string | null
        windowId: string | null
    }
    private mutationRateLimiter?: MutationRateLimiter

    captureStarted: boolean
    snapshots: any[]
    stopRrweb: listenerHandler | undefined
    receivedDecide: boolean
    rrwebRecord: rrwebRecord | undefined
    recorderVersion?: string
    isIdle = false

    constructor(instance: PostHog) {
        this.instance = instance
        this.captureStarted = false
        this.snapshots = []
        this.emit = false // Controls whether data is sent to the server or not
        this.endpoint = BASE_ENDPOINT
        this.stopRrweb = undefined
        this.windowId = null
        this.sessionId = null
        this.receivedDecide = false

        window.addEventListener('beforeunload', () => {
            this._flushBuffer()
        })
    }

    startRecordingIfEnabled() {
        if (this.isRecordingEnabled()) {
            this.startCaptureAndTrySendingQueuedSnapshots()
        } else {
            this.stopRecording()
        }
    }

    started() {
        return this.captureStarted
    }

    stopRecording() {
        if (this.captureStarted && this.stopRrweb) {
            this.stopRrweb()
            this.stopRrweb = undefined
            this.captureStarted = false
        }
    }

    isRecordingEnabled() {
        const enabled_server_side = !!this.instance.get_property(SESSION_RECORDING_ENABLED_SERVER_SIDE)
        const enabled_client_side = !this.instance.get_config('disable_session_recording')
        return enabled_server_side && enabled_client_side
    }

    isConsoleLogCaptureEnabled() {
        const enabled_server_side = !!this.instance.get_property(CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE)
        const enabled_client_side = this.instance.get_config('enable_recording_console_log')
        return enabled_client_side ?? enabled_server_side
    }

    getRecordingVersion() {
        const recordingVersion_server_side = this.instance.get_property(SESSION_RECORDING_RECORDER_VERSION_SERVER_SIDE)
        const recordingVersion_client_side = this.instance.get_config('session_recording')?.recorderVersion
        return recordingVersion_client_side || recordingVersion_server_side || 'v1'
    }

    afterDecideResponse(response: DecideResponse) {
        this.receivedDecide = true
        if (this.instance.persistence) {
            this.instance.persistence.register({
                [SESSION_RECORDING_ENABLED_SERVER_SIDE]: !!response['sessionRecording'],
                [CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE]: response.sessionRecording?.consoleLogRecordingEnabled,
                [SESSION_RECORDING_RECORDER_VERSION_SERVER_SIDE]: response.sessionRecording?.recorderVersion,
            })
        }
        if (response.sessionRecording?.endpoint) {
            this.endpoint = response.sessionRecording?.endpoint
        }

        if (response.sessionRecording?.recorderVersion) {
            this.recorderVersion = response.sessionRecording.recorderVersion
        }
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
                    // Even though it is a string we stringify it as thats what rrweb expects
                    payload: [JSON.stringify(message)],
                },
            },
            timestamp: _timestamp(),
        })
    }

    private startCaptureAndTrySendingQueuedSnapshots() {
        // Only submit data after we've received a decide response to account for
        // changing endpoints and the feature being disabled on the server side.
        if (this.receivedDecide) {
            this.emit = true
            this.snapshots.forEach((properties) => this._captureSnapshotBuffered(properties))
        }
        this._startCapture()
    }

    private _startCapture() {
        // According to the rrweb docs, rrweb is not supported on IE11 and below:
        // "rrweb does not support IE11 and below because it uses the MutationObserver API which was supported by these browsers."
        // https://github.com/rrweb-io/rrweb/blob/master/guide.md#compatibility-note
        //
        // However, MutationObserver does exist on IE11, it just doesn't work well and does not detect all changes.
        // Instead, when we load "recorder.js", the first JS error is about "Object.assign" being undefined.
        // Thus instead of MutationObserver, we look for this function and block recording if it's undefined.
        if (typeof Object.assign === 'undefined') {
            return
        }

        // We do not switch recorder versions midway through a recording.
        if (this.captureStarted || this.instance.get_config('disable_session_recording')) {
            return
        }

        this.captureStarted = true
        // We want to ensure the sessionManager is reset if necessary on load of the recorder
        this.instance.sessionManager.checkAndGetSessionAndWindowId()

        const recorderJS = this.getRecordingVersion() === 'v2' ? 'recorder-v2.js' : 'recorder.js'

        // If recorder.js is already loaded (if array.full.js snippet is used or posthog-js/dist/recorder is
        // imported) or matches the requested recorder version, don't load script. Otherwise, remotely import
        // recorder.js from cdn since it hasn't been loaded.
        if (this.instance.__loaded_recorder_version !== this.getRecordingVersion()) {
            loadScript(
                this.instance.get_config('api_host') + `/static/${recorderJS}?v=${Config.LIB_VERSION}`,
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

        if (!isUserInteraction && !this.isIdle) {
            // We check if the lastActivityTimestamp is old enough to go idle
            if (event.timestamp - this.lastActivityTimestamp > RECORDING_IDLE_ACTIVITY_TIMEOUT_MS) {
                this.isIdle = true
            }
        }

        if (isUserInteraction) {
            this.lastActivityTimestamp = event.timestamp
            if (this.isIdle) {
                // Remove the idle state if set and trigger a full snapshot as we will have ingored previous mutations
                this.isIdle = false
                this._tryTakeFullSnapshot()
            }
        }

        if (this.isIdle) {
            return
        }

        // We only want to extend the session if it is an interactive event.
        const { windowId, sessionId } = this.instance.sessionManager.checkAndGetSessionAndWindowId(
            !isUserInteraction,
            event.timestamp
        )

        if (
            [FULL_SNAPSHOT_EVENT_TYPE, META_EVENT_TYPE].indexOf(event.type) === -1 &&
            (this.windowId !== windowId || this.sessionId !== sessionId)
        ) {
            this._tryTakeFullSnapshot()
        }
        this.windowId = windowId
        this.sessionId = sessionId
    }

    private _tryTakeFullSnapshot(): boolean {
        if (!this.captureStarted) {
            return false
        }
        try {
            this.rrwebRecord?.takeFullSnapshot()
            return true
        } catch (e) {
            // Sometimes a race can occur where the recorder is not fully started yet, so we can't take a full snapshot.
            logger.error('Error taking full snapshot.', e)
            return false
        }
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

        // only allows user to set our 'allowlisted' options
        const userSessionRecordingOptions = this.instance.get_config('session_recording')
        for (const [key, value] of Object.entries(userSessionRecordingOptions || {})) {
            if (key in sessionRecordingOptions) {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                sessionRecordingOptions[key] = value
            }
        }

        if (!this.rrwebRecord) {
            logger.error(
                'onScriptLoaded was called but rrwebRecord is not available. This indicates something has gone wrong.'
            )
            return
        }

        this.mutationRateLimiter =
            this.mutationRateLimiter ??
            new MutationRateLimiter(this.rrwebRecord!, {
                onBlockedNode: (id, node) => {
                    const message = `Too many mutations on node '${id}'. Rate limiting. This could be due to SVG animations or something similar`
                    logger.log(message, {
                        node: node,
                    })

                    this.log('[PostHog Recorder] ' + message, 'warn')
                },
            })

        this.stopRrweb = this.rrwebRecord({
            emit: (event) => {
                this.onRRwebEmit(event)
            },
            plugins:
                (window as any).rrwebConsoleRecord && this.isConsoleLogCaptureEnabled()
                    ? [(window as any).rrwebConsoleRecord.getRecordConsolePlugin()]
                    : [],
            ...sessionRecordingOptions,
        })

        // :TRICKY: rrweb does not capture navigation within SPA-s, so hook into our $pageview events to get access to all events.
        //   Dropping the initial event is fine (it's always captured by rrweb).
        this.instance._addCaptureHook((eventName) => {
            // If anything could go wrong here it has the potential to block the main loop so we catch all errors.
            try {
                if (eventName === '$pageview') {
                    this.rrwebRecord?.addCustomEvent('$pageview', { href: window.location.href })
                }
            } catch (e) {
                logger.error('Could not add $pageview to rrweb session', e)
            }
        })

        // We reset the last activity timestamp, resetting the idle timer
        this.lastActivityTimestamp = Date.now()
        this.isIdle = false
    }

    onRRwebEmit(rawEvent: eventWithTime) {
        if (!rawEvent || typeof rawEvent !== 'object') {
            return
        }

        const throttledEvent = this.mutationRateLimiter
            ? this.mutationRateLimiter.throttleMutations(rawEvent)
            : rawEvent

        if (!throttledEvent) {
            return
        }

        const { event, size } = ensureMaxMessageSize(truncateLargeConsoleLogs(throttledEvent))

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

        if (this.emit) {
            this._captureSnapshotBuffered(properties)
        } else {
            this.snapshots.push(properties)
        }
    }

    private _flushBuffer() {
        if (this.flushBufferTimer) {
            clearTimeout(this.flushBufferTimer)
            this.flushBufferTimer = undefined
        }

        if (this.buffer && this.buffer.data.length !== 0) {
            this._captureSnapshot({
                $snapshot_bytes: this.buffer.size,
                $snapshot_data: this.buffer.data,
                $session_id: this.buffer.sessionId,
                $window_id: this.buffer.windowId,
            })
        }

        this.buffer = undefined

        return {
            size: 0,
            data: [],
            sessionId: this.sessionId,
            windowId: this.windowId,
        }
    }

    private _captureSnapshotBuffered(properties: Properties) {
        const additionalBytes = 2 + (this.buffer?.data.length || 0) // 2 bytes for the array brackets and 1 byte for each comma
        if (
            !this.buffer ||
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
            transport: 'XHR',
            method: 'POST',
            endpoint: this.endpoint,
            _noTruncate: true,
            _batchKey: SESSION_RECORDING_BATCH_KEY,
            _metrics: {
                rrweb_full_snapshot: properties.$snapshot_data.type === FULL_SNAPSHOT_EVENT_TYPE,
            },
        })
    }
}
