import { loadScript } from '../autocapture-utils'
import { _ } from '../utils'
import { SESSION_RECORDING_ENABLED } from '../posthog-persistence'

export class SessionRecording {
    constructor(instance) {
        this.instance = instance
        this.captureStarted = false
        this.snapshots = []
        this.emit = false
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
            this.submitRecordings()
        }
    }

    submitRecordings() {
        this.emit = true
        this._startCapture()
        this.snapshots.forEach((data) => {
            this.instance.capture('$snapshot', { $snapshot_data: data })
        })
    }

    _startCapture() {
        if (!this.captureStarted && !this.instance.disable_session_recording) {
            this.captureStarted = true
            loadScript(this.instance.get_config('api_host') + '/static/recorder.js', _.bind(this._onScriptLoaded, this))
        }
    }

    _onScriptLoaded() {
        window.rrweb.record({
            emit: (data) => {
                if (this.emit) {
                    this.instance.capture('$snapshot', { $snapshot_data: data })
                } else {
                    this.snapshots.push(data)
                }
            },
        })
    }
}
