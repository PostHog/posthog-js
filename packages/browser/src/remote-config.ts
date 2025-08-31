import { PostHog } from './posthog-core'
import { RemoteConfig } from './types'

import { createLogger } from './utils/logger'
import { assignableWindow } from './utils/globals'

const logger = createLogger('[RemoteConfig]')

export class RemoteConfigLoader {
    constructor(private readonly _instance: PostHog) {}

    get remoteConfig(): RemoteConfig | undefined {
        return assignableWindow._POSTHOG_REMOTE_CONFIG?.[this._instance.config.token]?.config
    }

    private _loadRemoteConfigJs(cb: (config?: RemoteConfig) => void): void {
        if (assignableWindow.__PosthogExtensions__?.loadExternalDependency) {
            assignableWindow.__PosthogExtensions__?.loadExternalDependency?.(this._instance, 'remote-config', () => {
                return cb(this.remoteConfig)
            })
        } else {
            logger.error('PostHog Extensions not found. Cannot load remote config.')
            cb()
        }
    }

    private _loadRemoteConfigJSON(cb: (config?: RemoteConfig) => void): void {
        this._instance._send_request({
            method: 'GET',
            url: this._instance.requestRouter.endpointFor('assets', `/array/${this._instance.config.token}/config`),
            callback: (response) => {
                cb(response.json as RemoteConfig | undefined)
            },
        })
    }

    load(): void {
        try {
            // Attempt 1 - use the pre-loaded config if it came as part of the token-specific array.js
            if (this.remoteConfig) {
                logger.info('Using preloaded remote config', this.remoteConfig)
                this._onRemoteConfig(this.remoteConfig)
                return
            }

            if (this._instance._shouldDisableFlags()) {
                // This setting is essentially saying "dont call external APIs" hence we respect it here
                logger.warn('Remote config is disabled. Falling back to local config.')
                return
            }

            // Attempt 2 - if we have the external deps loader then lets load the script version of the config that includes site apps
            this._loadRemoteConfigJs((config) => {
                if (!config) {
                    logger.info('No config found after loading remote JS config. Falling back to JSON.')
                    // Attempt 3 Load the config json instead of the script - we won't get site apps etc. but we will get the config
                    this._loadRemoteConfigJSON((config) => {
                        this._onRemoteConfig(config)
                    })
                    return
                }

                this._onRemoteConfig(config)
            })
        } catch (error) {
            logger.error('Error loading remote config', error)
        }
    }

    private _onRemoteConfig(config?: RemoteConfig): void {
        // NOTE: Once this is rolled out we will remove the /flags related code above. Until then the code duplication is fine.
        if (!config) {
            logger.error('Failed to fetch remote config from PostHog.')
            return
        }

        if (!this._instance.config.__preview_remote_config) {
            logger.info('__preview_remote_config is disabled. Logging config instead', config)
            return
        }

        this._instance._onRemoteConfig(config)

        // We only need to reload if we haven't already loaded the flags or if the request is in flight
        if (config.hasFeatureFlags !== false) {
            // If the config has feature flags, we need to call /flags to get the feature flags
            // This completely separates it from the config logic which is good in terms of separation of concerns
            this._instance.featureFlags.ensureFlagsLoaded()
        }
    }
}
