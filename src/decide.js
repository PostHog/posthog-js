import { autocapture } from './autocapture'
import { _ } from './utils'
import { parseFeatureFlagDecideResponse } from './posthog-featureflags'

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
            groups: this.instance.getGroups(),
        })

        const encoded_data = _.base64Encode(json_data)
        this.instance._send_request(
            `${this.instance.get_config('api_host')}/decide/?v=2`,
            { data: encoded_data, verbose: true },
            { method: 'POST' },
            (response) => this.parseDecideResponse(response)
        )
    }

    parseDecideResponse(response) {
        if (response?.status === 0) {
            return
        }
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

        parseFeatureFlagDecideResponse(response, this.instance.persistence)

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
