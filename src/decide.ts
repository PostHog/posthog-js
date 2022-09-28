import { autocapture } from './autocapture'
import { _base64Encode } from './utils'
import { PostHog } from './posthog-core'
import { Compression, DecideResponse } from './types'

export class Decide {
    instance: PostHog

    constructor(instance: PostHog) {
        this.instance = instance
        this.instance.decideEndpointWasHit = false
    }

    call(): void {
        /*
        Calls /decide endpoint to fetch options for autocapture, session recording, feature flags & compression.
        */
        const json_data = JSON.stringify({
            token: this.instance.get_config('token'),
            distinct_id: this.instance.get_distinct_id(),
            groups: this.instance.getGroups(),
        })

        const encoded_data = _base64Encode(json_data)
        this.instance._send_request(
            `${this.instance.get_config('api_host')}/decide/?v=2`,
            { data: encoded_data, verbose: true },
            { method: 'POST' },
            (response) => this.parseDecideResponse(response as DecideResponse)
        )
    }

    parseDecideResponse(response: DecideResponse): void {
        if (response?.status === 0) {
            console.error('Failed to fetch feature flags from PostHog.')
            return
        }
        this.instance.decideEndpointWasHit = true
        if (!(document && document.body)) {
            console.log('document not ready yet, trying again in 500 milliseconds...')
            setTimeout(() => {
                this.parseDecideResponse(response)
            }, 500)
            return
        }

        this.instance.toolbar.afterDecideResponse(response)
        this.instance.sessionRecording?.afterDecideResponse(response)
        autocapture.afterDecideResponse(response, this.instance)

        this.instance.featureFlags.receivedFeatureFlags(response)

        if (response['supportedCompression']) {
            const compression: Partial<Record<Compression, boolean>> = {}
            for (const method of response['supportedCompression']) {
                compression[method] = true
            }
            this.instance['compression'] = compression
        } else {
            this.instance['compression'] = {}
        }

        if (response['inject']) {
            for (const { id, source, config } of response['inject']) {
                try {
                    const apiHost = this.instance.get_config('api_host')
                    window.eval(source)?.(apiHost)?.inject?.({ config, posthog: this.instance })
                } catch (e) {
                    console.error(`[POSTHOG-JS] Error while initializing PostHog app with config id ${id}`, e)
                }
            }
        }
    }
}
