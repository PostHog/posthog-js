import { loadScript } from './autocapture-utils'
import { _ } from './utils'
import { SESSION_RECORDING_ENABLED } from './posthog-persistence'

export class PosthogSessionRecording {
    constructor(instance) {
        this.instance = instance
        this.captureStarted = false
        this.snapshots = []
        this.emit = false
    }

    _init() {
        if (this.instance.persistence.props[SESSION_RECORDING_ENABLED]) {
            this._startCapture()
        }
    }

    recordAndSubmit() {
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
