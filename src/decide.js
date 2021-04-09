import { autocapture } from './autocapture'
import { _ } from './utils'

export class Decide {
    constructor(instance) {
        this.instance = instance
    }

    callDecide() {
        const json_data = JSON.stringify({
            token: this.instance.get_config('token'),
            distinct_id: this.instance.get_distinct_id(),
        })

        const encoded_data = _.base64Encode(json_data)
        this.instance._send_request(
            this.instance.get_config('api_host') + '/decide/',
            { data: encoded_data },
            { method: 'POST' },
            (response) => this.parseDecideResponse(response)
        )
    }

    parseDecideResponse(response) {
        if (!(document && document.body)) {
            console.log('document not ready yet, trying again in 500 milliseconds...')
            setTimeout(function () {
                this.parseDecideResponse(response)
            }, 500)
            return
        }

        this.instance.toolbar.afterDecideResponse(response)
        this.instance.sessionRecording.afterDecideResponse(response)
        autocapture.afterDecideResponse(response, this.instance)

        if (response['featureFlags']) {
            this.instance.persistence &&
                this.instance.persistence.register({ $active_feature_flags: response['featureFlags'] })
        } else {
            this.instance.persistence && this.instance.persistence.unregister('$active_feature_flags')
        }

        if (response['supportedCompression']) {
            let compression = {}
            for (const method of response['supportedCompression']) {
                compression[method] = true
            }
            this.instance['compression'] = compression
        } else {
            this.instance['compression'] = {}
        }
    }
}
