import { autocapture } from './autocapture'
import { _base64Encode, loadScript } from './utils'
import { PostHog } from './posthog-core'
import { DecideResponse } from './types'
import { STORED_GROUP_PROPERTIES_KEY, STORED_PERSON_PROPERTIES_KEY } from './constants'

import { _isUndefined } from './utils/type-utils'
import { logger } from './utils/logger'
import { window, document, assignableWindow } from './utils/globals'

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
            token: this.instance.config.token,
            distinct_id: this.instance.get_distinct_id(),
            groups: this.instance.getGroups(),
            person_properties: this.instance.get_property(STORED_PERSON_PROPERTIES_KEY),
            group_properties: this.instance.get_property(STORED_GROUP_PROPERTIES_KEY),
            disable_flags:
                this.instance.config.advanced_disable_feature_flags ||
                this.instance.config.advanced_disable_feature_flags_on_first_load ||
                undefined,
        })

        const encoded_data = _base64Encode(json_data)
        this.instance._send_request(
            `${this.instance.config.api_host}/decide/?v=3`,
            { data: encoded_data, verbose: true },
            { method: 'POST' },
            (response) => this.parseDecideResponse(response as DecideResponse)
        )
    }

    parseDecideResponse(response: DecideResponse): void {
        this.instance.featureFlags.setReloadingPaused(false)
        // :TRICKY: Reload - start another request if queued!
        this.instance.featureFlags._startReloadTimer()

        if (response?.status === 0) {
            logger.error('Failed to fetch feature flags from PostHog.')
            return
        }
        if (!(document && document.body)) {
            logger.info('document not ready yet, trying again in 500 milliseconds...')
            setTimeout(() => {
                this.parseDecideResponse(response)
            }, 500)
            return
        }

        this.instance.toolbar.afterDecideResponse(response)
        this.instance.sessionRecording?.afterDecideResponse(response)
        autocapture.afterDecideResponse(response, this.instance)
        this.instance.webPerformance?.afterDecideResponse(response)
        this.instance._afterDecideResponse(response)

        if (!this.instance.config.advanced_disable_feature_flags_on_first_load) {
            this.instance.featureFlags.receivedFeatureFlags(response)
        }

        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const surveysGenerator = window?.extendPostHogWithSurveys

        if (response['surveys'] && !surveysGenerator) {
            loadScript(this.instance.config.api_host + `/static/surveys.js`, (err) => {
                if (err) {
                    return logger.error(`Could not load surveys script`, err)
                }

                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                window.extendPostHogWithSurveys(this.instance)
            })
        }

        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const exceptionAutoCaptureAddedToWindow = window?.extendPostHogWithExceptionAutoCapture
        if (
            response['autocaptureExceptions'] &&
            !!response['autocaptureExceptions'] &&
            _isUndefined(exceptionAutoCaptureAddedToWindow)
        ) {
            loadScript(this.instance.config.api_host + `/static/exception-autocapture.js`, (err) => {
                if (err) {
                    return logger.error(`Could not load exception autocapture script`, err)
                }

                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                window.extendPostHogWithExceptionAutocapture(this.instance, response)
            })
        }

        if (response['siteApps']) {
            if (this.instance.config.opt_in_site_apps) {
                const apiHost = this.instance.config.api_host
                for (const { id, url } of response['siteApps']) {
                    const scriptUrl = [
                        apiHost,
                        apiHost[apiHost.length - 1] === '/' && url[0] === '/' ? url.substring(1) : url,
                    ].join('')

                    assignableWindow[`__$$ph_site_app_${id}`] = this.instance

                    loadScript(scriptUrl, (err) => {
                        if (err) {
                            logger.error(`Error while initializing PostHog app with config id ${id}`, err)
                        }
                    })
                }
            } else if (response['siteApps'].length > 0) {
                logger.error('PostHog site apps are disabled. Enable the "opt_in_site_apps" config to proceed.')
            }
        }
    }
}
