import { PostHog } from './posthog-core'
import { RemoteConfig } from './types'

import { createLogger } from '@posthog/browser-common/utils/logger'
import { assignableWindow } from './utils/globals'
import type { RequestResponse } from '@posthog/types'
import { getExtensionLoader } from './utils/extension-loader'

const logger = /* @__PURE__ */ createLogger('[RemoteConfig]')

export class RemoteConfigLoader {
    constructor(private readonly _instance: PostHog) {}

    get remoteConfig(): RemoteConfig | undefined {
        return assignableWindow._POSTHOG_REMOTE_CONFIG?.[this._instance.config.token]?.config
    }

    private _loadRemoteConfigJs(cb: (config?: RemoteConfig) => void): void {
        const loadExternalDependency = getExtensionLoader(this._instance)
        if (loadExternalDependency) {
            loadExternalDependency(this._instance, 'remote-config', () => {
                return cb(this.remoteConfig)
            })
        } else {
            cb()
        }
    }

    private _loadRemoteConfigJSON(cb: (response: RequestResponse) => void): void {
        // Concurrent loads (e.g. replay refreshing stale config during init) share one JSON request, as they
        // previously shared one config.js script tag. Stored unmangled on the instance so slim bundles share it.
        const pending = this._instance.__pending_remote_config_callbacks
        if (pending) {
            pending.push(cb)
            return
        }
        const callbacks = [cb]
        this._instance.__pending_remote_config_callbacks = callbacks
        try {
            this._instance._send_request({
                method: 'GET',
                url: this._instance.requestRouter.endpointFor('assets', `/array/${this._instance.config.token}/config`),
                // Without a batchKey the rate limiter treats this as `events` and drops it while events are quota limited.
                batchKey: 'remote_config',
                fireCallbackOnDrop: true,
                callback: (response) => {
                    this._instance.__pending_remote_config_callbacks = undefined
                    callbacks.forEach((callback) => callback(response))
                },
            })
        } catch (error) {
            this._instance.__pending_remote_config_callbacks = undefined
            throw error
        }
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

            // config.js is executable and only adds site-app code over the JSON endpoint, so never load it unless site apps
            // are enabled, not even as a fallback when the JSON request fails.
            if (!this._instance.config.opt_in_site_apps) {
                this._loadRemoteConfigJSON((response) => {
                    this._onRemoteConfig(response.json as RemoteConfig | undefined, response)
                })
                return
            }

            // Attempt 2 - if we have the external deps loader then lets load the script version of the config that includes site apps
            this._loadRemoteConfigJs((config) => {
                if (!config) {
                    logger.info('No config found after loading remote JS config. Falling back to JSON.')
                    // Attempt 3 Load the config json instead of the script - we won't get site apps etc. but we will get the config
                    this._loadRemoteConfigJSON((response) => {
                        this._onRemoteConfig(response.json as RemoteConfig | undefined, response)
                    })
                    return
                }

                this._onRemoteConfig(config)
            })
        } catch (error) {
            logger.error('Error loading remote config', error)
            this._onRemoteConfig()
        }
    }

    private _onRemoteConfig(config?: RemoteConfig, response?: RequestResponse): void {
        if (!config && response) {
            if (response.statusCode === 0) {
                if (!response.error) {
                    logger.warn('Failed to fetch remote config from PostHog.')
                }
            } else {
                logger.error('Failed to fetch remote config from PostHog.')
            }
        }

        // Config and flags are loaded separately: config from /array/{token}/config,
        // flags from /flags/?v=2. Features like surveys, session recording, and product
        // tours reference flags in their config (e.g. survey.linked_flag_key), but this
        // is safe because those flag checks happen lazily at runtime (e.g. when deciding
        // whether to show a survey), not during config processing. By the time a linked
        // flag is evaluated, flags have already loaded.
        //
        // Even when config fails, we notify extensions so they initialize with their
        // defaults — as an explicit failure, so settings that must not fail open
        // (e.g. autocapture's opt-out) can keep their last known value.
        try {
            this._instance._onRemoteConfig(config ? { ok: true, config } : { ok: false })
        } catch (error) {
            logger.error('Error applying remote config', error)
        }

        if (config?.hasFeatureFlags !== false && !this._instance.config.advanced_disable_feature_flags_on_first_load) {
            try {
                this._instance.featureFlags?.ensureFlagsLoaded()
            } catch (error) {
                logger.error('Error loading feature flags', error)
            }
        }
    }
}
