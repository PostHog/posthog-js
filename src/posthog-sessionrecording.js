import { loadScript } from './autocapture-utils'

export class PosthogSessionRecording {
    constructor(instance) {
        this.instance = instance
    }

    init() {
        loadScript(this.instance.get_config('api_host') + '/static/recorder.js', this._onScriptLoaded)
    }

    _onScriptLoaded() {
        window.rrweb.record({
            emit(data) {
                posthog.capture('$snapshot', { $snapshot_data: data })
            },
        })
    }
}
