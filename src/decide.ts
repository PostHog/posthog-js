import { autocapture } from './autocapture'
import { _base64Encode, loadScript } from './utils'
import { PostHog } from './posthog-core'
import { Compression, DecideResponse } from './types'
import { STORED_GROUP_PROPERTIES_KEY, STORED_PERSON_PROPERTIES_KEY } from './posthog-persistence'

export class Decide {
    instance: PostHog

    constructor(instance: PostHog) {
        this.instance = instance
        // don't need to wait for `decide` to return if flags were provided on initialisation
        this.instance.decideEndpointWasHit = this.instance._hasBootstrappedFeatureFlags()
    }

    call(): void {
        /*
        Calls /decide endpoint to fetch options for autocapture, session recording, feature flags & compression.
        */
        const json_data = JSON.stringify({
            token: this.instance.get_config('token'),
            distinct_id: this.instance.get_distinct_id(),
            groups: this.instance.getGroups(),
            person_properties: this.instance.get_property(STORED_PERSON_PROPERTIES_KEY),
            group_properties: this.instance.get_property(STORED_GROUP_PROPERTIES_KEY),
        })

        const encoded_data = _base64Encode(json_data)
        this.instance._send_request(
            `${this.instance.get_config('api_host')}/decide/?v=3`,
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
        this.instance.webPerformance?.afterDecideResponse(response)

        this.instance.featureFlags.receivedFeatureFlags(response)

        this.instance['compression'] = {}
        if (response['supportedCompression'] && !this.instance.get_config('disable_compression')) {
            const compression: Partial<Record<Compression, boolean>> = {}
            for (const method of response['supportedCompression']) {
                compression[method] = true
            }
            this.instance['compression'] = compression
        }

        if (response['siteApps']) {
            if (this.instance.get_config('opt_in_site_apps')) {
                const apiHost = this.instance.get_config('api_host')
                for (const { id, url } of response['siteApps']) {
                    const scriptUrl = [
                        apiHost,
                        apiHost[apiHost.length - 1] === '/' && url[0] === '/' ? url.substring(1) : url,
                    ].join('')

                    ;(window as any)[`__$$ph_site_app_${id}`] = this.instance

                    loadScript(scriptUrl, (err) => {
                        if (err) {
                            console.error(`Error while initializing PostHog app with config id ${id}`, err)
                        }
                    })
                }
            } else if (response['siteApps'].length > 0) {
                console.error('PostHog site apps are disabled. Enable the "opt_in_site_apps" config to proceed.')
            }
        }
    }
}
