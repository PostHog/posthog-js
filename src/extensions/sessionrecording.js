import { loadScript } from '../autocapture-utils'
import { _ } from '../utils'
import { SESSION_RECORDING_ENABLED } from '../posthog-persistence'
import Config from '../config'
import { filterDataURLsFromLargeDataObjects } from './sessionrecording-utils'

const BASE_ENDPOINT = '/e/'

export class SessionRecording {
    constructor(instance) {
        this.instance = instance
        this.captureStarted = false
        this.snapshots = []
        this.emit = false
        this.endpoint = BASE_ENDPOINT
        this.stopRrweb = null
        this.windowId = null
        this.sessionId = null
    }

    startRecordingIfEnabled() {
        if (
            this.instance.get_property(SESSION_RECORDING_ENABLED) &&
            !this.instance.get_config('disable_session_recording')
        ) {
            this._startCapture()
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

    afterDecideResponse(response) {
        const enableRecordings =
            !this.instance.get_config('disable_session_recording') && !!response['sessionRecording']
        if (this.instance.persistence) {
            this.instance.persistence.register({ [SESSION_RECORDING_ENABLED]: enableRecordings })
        }

        if (enableRecordings) {
            if (response['sessionRecording'].endpoint) {
                this.endpoint = response['sessionRecording'].endpoint
            }
            this.submitRecordings()
        }
    }

    submitRecordings() {
        this.emit = true
        this._startCapture()
        this.snapshots.forEach((properties) => this._captureSnapshot(properties))
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
        let canTriggerIDRefresh = true
        // Event type 3 is incremental update, and source 0 is a mutation.
        // These events are not caused by user interaction, so they should not
        // trigger a new session to start
        if (event.type === 3 && event.data?.source === 0) {
            canTriggerIDRefresh = false
        }

        const { windowId, sessionId } = this.instance['_sessionIdManager'].getSessionAndWindowId(
            event.timestamp || new Date(),
            canTriggerIDRefresh
        )

        // Data type 2 and 4 are FullSnapshot and Meta and they mean we're already
        // in the process of sending a full snapshot
        if ((this.windowId !== windowId || this.sessionId !== sessionId) && [2, 4].indexOf(event.type) === -1) {
            window.rrweb.record.takeFullSnapshot()
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
            maskAllInputs: false,
            maskInputOptions: {},
            maskInputFn: null,
            slimDOMOptions: {},
            collectFonts: false,
        }

        // only allows user to set our 'whitelisted' options
        const userSessionRecordingOptions = this.instance.get_config('session_recording')
        for (const [key, value] of Object.entries(userSessionRecordingOptions || {})) {
            if (key in sessionRecordingOptions) {
                sessionRecordingOptions[key] = value
            }
        }

        this.stopRrweb = window.rrweb.record({
            emit: (event) => {
                event = filterDataURLsFromLargeDataObjects(event)

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
            ...sessionRecordingOptions,
        })

        // :TRICKY: rrweb does not capture navigation within SPA-s, so hook into our $pageview events to get access to all events.
        //   Dropping the initial event is fine (it's always captured by rrweb).
        this.instance._addCaptureHook((eventName) => {
            if (eventName === '$pageview') {
                window.rrweb.record.addCustomEvent('$pageview', { href: window.location.href })
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
                rrweb_full_snapshot: properties.$snapshot_data.type === 2,
            },
        })
    }
}
