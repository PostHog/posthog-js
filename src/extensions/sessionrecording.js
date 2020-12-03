import { loadScript } from '../autocapture-utils'
import { _ } from '../utils'
import { SESSION_RECORDING_ENABLED } from '../posthog-persistence'
import sessionIdGenerator from './sessionid'

const BASE_ENDPOINT = '/e/'

export class SessionRecording {
    constructor(instance) {
        this.instance = instance
        this.captureStarted = false
        this.snapshots = []
        this.emit = false
        this.endpoint = BASE_ENDPOINT
    }

    startRecordingIfEnabled() {
        if (this.instance.get_property(SESSION_RECORDING_ENABLED)) {
            this._startCapture()
        }
    }

    afterDecideResponse(response) {
        if (this.instance.persistence) {
            this.instance.persistence.register({ [SESSION_RECORDING_ENABLED]: !!response['sessionRecording'] })
        }

        if (response['sessionRecording']) {
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
        // If session recording is enabled, we send events to server more frequently
        this.instance._requestQueue.setPollInterval(300)
    }

    _startCapture() {
        if (!this.captureStarted && !this.instance.get_config('disable_session_recording')) {
            this.captureStarted = true
            loadScript(this.instance.get_config('api_host') + '/static/recorder.js', _.bind(this._onScriptLoaded, this))
        }
    }

    _onScriptLoaded() {
        // rrweb config info: https://github.com/rrweb-io/rrweb/blob/7d5d0033258d6c29599fb08412202d9a2c7b9413/src/record/index.ts#L28
        window.rrweb.record({
            emit: (data) => {
                const properties = {
                    $snapshot_data: data,
                    $session_id: sessionIdGenerator(this.instance.persistence, data.timestamp),
                }

                this.instance._captureMetrics.incr('rrweb-record')
                this.instance._captureMetrics.incr(`rrweb-record-${data.type}`)

                if (this.emit) {
                    this._captureSnapshot(properties)
                } else {
                    this.snapshots.push(properties)
                }
            },
            blockClass: 'ph-no-capture', // Does not capture the element at all
            ignoreClass: 'ph-ignore-input', // Ignores content of input but still records the input element
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
            compression: 'lz64', // Force lz64 even if /decide endpoint has not yet responded
            _noTruncate: true,
            _batchKey: 'sessionRecording',
            _metrics: {
                rrweb_full_snapshot: properties.$snapshot_data.type === 2,
            },
        })
    }
}
