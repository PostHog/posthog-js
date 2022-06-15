import { loadScript } from '../autocapture-utils'
import { _ } from '../utils'
import { SESSION_RECORDING_ENABLED_SERVER_SIDE } from '../posthog-persistence'
import Config from '../config'
import { filterDataURLsFromLargeDataObjects, truncateLargeConsoleLogs } from './sessionrecording-utils'
import { onPageVisibility } from '../page-activity'

const BASE_ENDPOINT = '/e/'

export const FULL_SNAPSHOT_EVENT_TYPE = 2
export const META_EVENT_TYPE = 4
export const INCREMENTAL_SNAPSHOT_EVENT_TYPE = 3
export const PLUGIN_EVENT_TYPE = 6
export const MUTATION_SOURCE_TYPE = 0

export class SessionRecording {
    constructor(instance) {
        this.instance = instance
        this.captureStarted = false
        this.snapshots = []
        this.emit = false // Controls whether data is sent to the server or not
        this.endpoint = BASE_ENDPOINT
        this.stopRrweb = null
        this.windowId = null
        this.sessionId = null
        this.receivedDecide = false
        this.pageIsVisible = true
    }

    startRecordingIfEnabled() {
        if (this.isRecordingEnabled()) {
            this.startCaptureAndTrySendingQueuedSnapshots()
            onPageVisibility((pageIsVisible) => (this.pageIsVisible = pageIsVisible))
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
            this.stopRrweb = null
            this.captureStarted = false
        }
    }

    isRecordingEnabled() {
        const enabled_server_side = !!this.instance.get_property(SESSION_RECORDING_ENABLED_SERVER_SIDE)
        const enabled_client_side = !this.instance.get_config('disable_session_recording')
        return enabled_server_side && enabled_client_side
    }

    afterDecideResponse(response) {
        this.receivedDecide = true
        if (this.instance.persistence) {
            this.instance.persistence.register({
                [SESSION_RECORDING_ENABLED_SERVER_SIDE]: !!response['sessionRecording'],
            })
        }
        if (response.sessionRecording?.endpoint) {
            this.endpoint = response.sessionRecording?.endpoint
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
        if (!this.captureStarted && !this.instance.get_config('disable_session_recording')) {
            this.captureStarted = true
            loadScript(
                this.instance.get_config('api_host') + '/static/recorder.js?v=' + Config.LIB_VERSION,
                _.bind(this._onScriptLoaded, this)
            )
        }
    }

    _updateWindowAndSessionIds(event) {
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
            (this.windowId !== windowId || this.sessionId !== sessionId) &&
            [FULL_SNAPSHOT_EVENT_TYPE, META_EVENT_TYPE].indexOf(event.type) === -1
        ) {
            this.rrwebRecord.takeFullSnapshot()
        }
        this.windowId = windowId
        this.sessionId = sessionId
    }

    _onScriptLoaded() {
        // rrweb config info: https://github.com/rrweb-io/rrweb/blob/7d5d0033258d6c29599fb08412202d9a2c7b9413/src/record/index.ts#L28
        const sessionRecordingOptions = {
            // select set of rrweb config options we expose to our users
            // see https://github.com/rrweb-io/rrweb/blob/master/guide.md
            blockClass: 'ph-no-capture',
            blockSelector: null,
            ignoreClass: 'ph-ignore-input',
            maskAllInputs: true,
            maskInputOptions: {},
            maskInputFn: null,
            slimDOMOptions: {},
            collectFonts: false,
            inlineStylesheet: true,
        }
        // We switched from loading all of rrweb to just the record part, but
        // keep backwards compatibility if someone hasn't upgraded PostHog
        this.rrwebRecord = window.rrweb ? window.rrweb.record : window.rrwebRecord

        // only allows user to set our 'whitelisted' options
        const userSessionRecordingOptions = this.instance.get_config('session_recording')
        for (const [key, value] of Object.entries(userSessionRecordingOptions || {})) {
            if (key in sessionRecordingOptions) {
                sessionRecordingOptions[key] = value
            }
        }

        this.stopRrweb = this.rrwebRecord({
            emit: (event) => {
                if (!this.pageIsVisible) {
                    return // don't record an invisible page
                }

                event = truncateLargeConsoleLogs(filterDataURLsFromLargeDataObjects(event))

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
                window.rrwebConsoleRecord && this.instance.get_config('enable_recording_console_log')
                    ? [window.rrwebConsoleRecord.getRecordConsolePlugin()]
                    : [],
            ...sessionRecordingOptions,
        })

        // :TRICKY: rrweb does not capture navigation within SPA-s, so hook into our $pageview events to get access to all events.
        //   Dropping the initial event is fine (it's always captured by rrweb).
        this.instance._addCaptureHook((eventName) => {
            if (eventName === '$pageview') {
                this.rrwebRecord.addCustomEvent('$pageview', { href: window.location.href })
            }
        })
    }

    _captureSnapshot(properties) {
        // :TRICKY: Make sure we batch these requests, use a custom endpoint and don't truncate the strings.
        this.instance.capture('$snapshot', properties, {
            transport: 'XHR',
            method: 'POST',
            endpoint: this.endpoint,
            _forceCompression: true,
            _noTruncate: true,
            _batchKey: 'sessionRecording',
            _metrics: {
                rrweb_full_snapshot: properties.$snapshot_data.type === FULL_SNAPSHOT_EVENT_TYPE,
            },
        })
    }
}
