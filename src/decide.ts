import { PostHog } from './posthog-core'
import { Compression, DecideResponse, RemoteConfig } from './types'
import { STORED_GROUP_PROPERTIES_KEY, STORED_PERSON_PROPERTIES_KEY } from './constants'

import { logger } from './utils/logger'
import { assignableWindow, document } from './utils/globals'

export class Decide {
    constructor(private readonly instance: PostHog) {
        // don't need to wait for `decide` to return if flags were provided on initialisation
        this.instance.decideEndpointWasHit = this.instance._hasBootstrappedFeatureFlags()
    }

    private _loadRemoteConfigJs(cb: (config?: RemoteConfig) => void): void {
        if (assignableWindow.__PosthogExtensions__?.loadExternalDependency) {
            assignableWindow.__PosthogExtensions__?.loadExternalDependency?.(this.instance, 'remote-config', () => {
                return cb(assignableWindow._POSTHOG_CONFIG)
            })
        } else {
            logger.error('PostHog Extensions not found. Cannot load remote config.')
            cb()
        }
    }

    private _loadRemoteConfigJSON(cb: (config?: RemoteConfig) => void): void {
        this.instance._send_request({
            method: 'GET',
            url: this.instance.requestRouter.endpointFor('assets', `/array/${this.instance.config.token}/config`),
            callback: (response) => {
                cb(response.json as RemoteConfig | undefined)
            },
        })
    }

    call(): void {
        // Call decide to get what features are enabled and other settings.
        // As a reminder, if the /decide endpoint is disabled, feature flags, toolbar, session recording, autocapture,
        // and compression will not be available.
        const disableRemoteCalls = !!this.instance.config.advanced_disable_decide

        if (!disableRemoteCalls) {
            // TRICKY: Reset any decide reloads queued during config.loaded because they'll be
            // covered by the decide call right above.
            this.instance.featureFlags.resetRequestQueue()
        }

        if (this.instance.config.__preview_remote_config) {
            // Attempt 1 - use the pre-loaded config if it came as part of the token-specific array.js
            if (assignableWindow._POSTHOG_CONFIG) {
                logger.info('Using preloaded remote config', assignableWindow._POSTHOG_CONFIG)
                this.onRemoteConfig(assignableWindow._POSTHOG_CONFIG)
                return
            }

            if (disableRemoteCalls) {
                logger.warn('Remote config is disabled. Falling back to local config.')
                return
            }

            // Attempt 2 - if we have the external deps loader then lets load the script version of the config that includes site apps
            this._loadRemoteConfigJs((config) => {
                if (!config) {
                    logger.info('No config found after loading remote JS config. Falling back to JSON.')
                    // Attempt 3 Load the config json instead of the script - we won't get site apps etc. but we will get the config
                    this._loadRemoteConfigJSON((config) => {
                        this.onRemoteConfig(config)
                    })
                    return
                }

                this.onRemoteConfig(config)
            })

            return
        }

        if (disableRemoteCalls) {
            return
        }

        /*
        Calls /decide endpoint to fetch options for autocapture, session recording, feature flags & compression.
        */
        const data = {
            token: this.instance.config.token,
            distinct_id: this.instance.get_distinct_id(),
            groups: this.instance.getGroups(),
            person_properties: this.instance.get_property(STORED_PERSON_PROPERTIES_KEY),
            group_properties: this.instance.get_property(STORED_GROUP_PROPERTIES_KEY),
            disable_flags:
                this.instance.config.advanced_disable_feature_flags ||
                this.instance.config.advanced_disable_feature_flags_on_first_load ||
                undefined,
        }

        this.instance._send_request({
            method: 'POST',
            url: this.instance.requestRouter.endpointFor('api', '/decide/?v=3'),
            data,
            compression: this.instance.config.disable_compression ? undefined : Compression.Base64,
            timeout: this.instance.config.feature_flag_request_timeout_ms,
            callback: (response) => this.parseDecideResponse(response.json as DecideResponse | undefined),
        })
    }

    parseDecideResponse(response?: DecideResponse): void {
        this.instance.featureFlags.setReloadingPaused(false)
        // :TRICKY: Reload - start another request if queued!
        this.instance.featureFlags._startReloadTimer()

        const errorsLoading = !response

        if (
            !this.instance.config.advanced_disable_feature_flags_on_first_load &&
            !this.instance.config.advanced_disable_feature_flags
        ) {
            this.instance.featureFlags.receivedFeatureFlags(response ?? {}, errorsLoading)
        }

        if (errorsLoading) {
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

        this.instance._onRemoteConfig(response)
    }

    private onRemoteConfig(config?: RemoteConfig): void {
        // NOTE: Once this is rolled out we will remove the "decide" related code above. Until then the code duplication is fine.
        if (!config) {
            logger.error('Failed to fetch remote config from PostHog.')
            return
        }
        if (!(document && document.body)) {
            logger.info('document not ready yet, trying again in 500 milliseconds...')
            setTimeout(() => {
                this.onRemoteConfig(config)
            }, 500)
            return
        }

        this.instance._onRemoteConfig(config)

        if (config.hasFeatureFlags !== false) {
            // TRICKY: This is set in the parent for some reason...
            this.instance.featureFlags.setReloadingPaused(false)
            // If the config has feature flags, we need to call decide to get the feature flags
            // This completely separates it from the config logic which is good in terms of separation of concerns
            this.instance.featureFlags.reloadFeatureFlags()
        }
    }
}
