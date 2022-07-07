import { autocapture } from './autocapture'
import { _ } from './utils'

export class Decide {
    constructor(instance) {
        this.instance = instance
        this.instance.decideEndpointWasHit = false
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
            (response) => this.parseDecideResponse(response),
            (error) => this.parseDecideError(error)
        )
    }

    parseDecideResponse(response) {
        if (response?.status === 0) {
            console.error('Failed to fetch feature flags from PostHog.')
            return
        }
        this.instance.decideEndpointWasHit = true
        if (!document?.body) {
            console.log('document not ready yet, trying again in 500 milliseconds...')
            setTimeout(() => this.parseDecideResponse(response), 500)
            return
        }

        this.instance.toolbar.afterDecideResponse(response)
        this.instance.sessionRecording.afterDecideResponse(response)
        autocapture.afterDecideResponse(response, this.instance)
        this.instance.featureFlags.receivedFeatureFlags(response)

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

    parseDecideError(error) {
        if (!document?.body) {
            console.log('document not ready yet, trying again in 500 milliseconds...')
            setTimeout(() => this.parseDecideError(error), 500)
            return
        }
        this.instance.receivedDecideError(error)
    }
}
