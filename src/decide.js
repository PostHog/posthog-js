import { autocapture } from './autocapture'
import { _ } from './utils'

export class Decide {
    constructor(instance) {
        this.instance = instance
    }

    call() {
        /*
        Calls /decide endpoint to fetch options for autocapture, session recording, feature flags & compression.
        */
        const json_data = JSON.stringify({
            token: this.instance.get_config('token'),
            distinct_id: this.instance.get_distinct_id(),
        })

        const encoded_data = _.base64Encode(json_data)
        const decide_api_version = this.instance.get_config('decide_api_version')
        const request_path = `/decide/${decide_api_version ? `?v=${decide_api_version}` : ''}`
        this.instance._send_request(
            this.instance.get_config('api_host') + request_path,
            { data: encoded_data },
            { method: 'POST' },
            (response) => this.parseDecideResponse(response)
        )
    }

    parseDecideResponse(response) {
        if (!(document && document.body)) {
            console.log('document not ready yet, trying again in 500 milliseconds...')
            setTimeout(() => {
                this.parseDecideResponse(response)
            }, 500)
            return
        }

        this.instance.toolbar.afterDecideResponse(response)
        this.instance.sessionRecording.afterDecideResponse(response)
        autocapture.afterDecideResponse(response, this.instance)

        const flags = response['featureFlags']
        if (flags) {
            const uses_v1_api = Array.isArray(flags)
            const $active_feature_flags = uses_v1_api ? flags : Object.keys(flags)
            this.instance.persistence &&
                this.instance.persistence.register({
                    $active_feature_flags,
                    $enabled_feature_flags: uses_v1_api ? undefined : flags,
                })
        } else {
            if (this.instance.persistence) {
                this.instance.persistence.unregister('$active_feature_flags')
                this.instance.persistence.unregister('$enabled_feature_flags')
            }
        }

        if (response['supportedCompression']) {
            const compression = {}
            for (const method of response['supportedCompression']) {
                compression[method] = true
            }
            this.instance['compression'] = compression
        } else {
            this.instance['compression'] = {}
        }
    }
}
