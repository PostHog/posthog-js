import {
    CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_RECORDING_RECORDER_VERSION_SERVER_SIDE,
} from '../posthog-persistence'
import {
    filterDataURLsFromLargeDataObjects,
    FULL_SNAPSHOT_EVENT_TYPE,
    INCREMENTAL_SNAPSHOT_EVENT_TYPE,
    META_EVENT_TYPE,
    MUTATION_SOURCE_TYPE,
    truncateLargeConsoleLogs,
} from './sessionrecording-utils'
import { PostHog } from '../posthog-core'
import { DecideResponse, Properties } from '../types'
import type { record } from 'rrweb/typings'
import type { eventWithTime, listenerHandler, pluginEvent, recordOptions } from 'rrweb/typings/types'
import { loadScript } from '../autocapture-utils'
import Config from '../config'
import { logger } from '../utils'

const BASE_ENDPOINT = '/e/'

export class SessionRecording {
    instance: PostHog
    captureStarted: boolean
    snapshots: any[]
    emit: boolean
    endpoint: string
    stopRrweb: listenerHandler | undefined
    windowId: string | null
    sessionId: string | null
    receivedDecide: boolean
    rrwebRecord: typeof record | undefined
    recorderVersion?: string

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

    startCaptureAndTrySendingQueuedSnapshots() {
        // Only submit data after we've received a decide response to account for
        // changing endpoints and the feature being disabled on the server side.
        if (this.receivedDecide) {
            this.emit = true
            this.snapshots.forEach((properties) => this._captureSnapshot(properties))
        }
        this._startCapture()
    }

    _startCapture() {
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

        const recorderJS = this.getRecordingVersion() === 'v2' ? 'recorder-v2.js' : 'recorder.js'

        // If recorder.js is already loaded (if array.full.js snippet is used or posthog-js/dist/recorder is
        // imported) or matches the requested recorder version, don't load script. Otherwise, remotely import
        // recorder.js from cdn since it hasn't been loaded.
        if (this.instance.__loaded_recorder_version !== this.getRecordingVersion()) {
            loadScript(
                this.instance.get_config('api_host') + `/static/${recorderJS}?v=${Config.LIB_VERSION}`,
                this._onScriptLoaded.bind(this)
            )
        } else {
            this._onScriptLoaded()
        }
    }

    _updateWindowAndSessionIds(event: eventWithTime) {
        // Some recording events are triggered by non-user events (e.g. "X minutes ago" text updating on the screen).
        // We don't want to extend the session or trigger a new session in these cases. These events are designated by event
        // type -> incremental update, and source -> mutation.
        const isNotUserInteraction =
            event.type === INCREMENTAL_SNAPSHOT_EVENT_TYPE && event.data?.source === MUTATION_SOURCE_TYPE

        const { windowId, sessionId } = this.instance.sessionManager.checkAndGetSessionAndWindowId(
            isNotUserInteraction,
            event.timestamp
        )

        // Event types FullSnapshot and Meta mean we're already in the process of sending a full snapshot
        if (
            this.captureStarted &&
            (this.windowId !== windowId || this.sessionId !== sessionId) &&
            [FULL_SNAPSHOT_EVENT_TYPE, META_EVENT_TYPE].indexOf(event.type) === -1
        ) {
            try {
                this.rrwebRecord?.takeFullSnapshot()
            } catch (e) {
                // Sometimes a race can occur where the recorder is not fully started yet, so we can't take a full snapshot.
                logger.error('Error taking full snapshot.', e)
            }
        }
        this.windowId = windowId
        this.sessionId = sessionId
    }

    _onScriptLoaded() {
        // rrweb config info: https://github.com/rrweb-io/rrweb/blob/7d5d0033258d6c29599fb08412202d9a2c7b9413/src/record/index.ts#L28
        const sessionRecordingOptions: recordOptions<eventWithTime> = {
            // select set of rrweb config options we expose to our users
            // see https://github.com/rrweb-io/rrweb/blob/master/guide.md
            blockClass: 'ph-no-capture',
            blockSelector: undefined,
            ignoreClass: 'ph-ignore-input',
            maskTextClass: 'ph-mask',
            maskTextSelector: undefined,
            maskAllInputs: true,
            maskInputOptions: {},
            maskInputFn: undefined,
            slimDOMOptions: {},
            collectFonts: false,
            inlineStylesheet: true,
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

        this.stopRrweb = this.rrwebRecord({
            emit: (event) => {
                event = truncateLargeConsoleLogs(
                    filterDataURLsFromLargeDataObjects(event) as pluginEvent<{ payload: string[] }>
                ) as eventWithTime

                this._updateWindowAndSessionIds(event)

                const properties = {
                    $snapshot_data: event,
                    $session_id: this.sessionId,
                    $window_id: this.windowId,
                }

                this.instance._captureMetrics.incr('rrweb-record')
                this.instance._captureMetrics.incr(`rrweb-record-${event.type}`)

                if (this.emit) {
                    this._captureSnapshot(properties)
                } else {
                    this.snapshots.push(properties)
                }
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
    }

    _captureSnapshot(properties: Properties) {
        // :TRICKY: Make sure we batch these requests, use a custom endpoint and don't truncate the strings.
        this.instance.capture('$snapshot', properties, {
            transport: 'XHR',
            method: 'POST',
            endpoint: this.endpoint,
            _noTruncate: true,
            _batchKey: 'sessionRecording',
            _metrics: {
                rrweb_full_snapshot: properties.$snapshot_data.type === FULL_SNAPSHOT_EVENT_TYPE,
            },
        })
    }
}
