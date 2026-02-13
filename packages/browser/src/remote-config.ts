import { PostHog } from './posthog-core'
import { RemoteConfig } from './types'

import { createLogger } from './utils/logger'
import { assignableWindow } from './utils/globals'
import { document } from './utils/globals'
import { addEventListener } from './utils'

const logger = createLogger('[RemoteConfig]')

// 5 minutes in milliseconds
const REFRESH_INTERVAL = 5 * 60 * 1000

export class RemoteConfigLoader {
    private _refreshInterval: ReturnType<typeof setInterval> | undefined
    private _onVisibilityChangeHandler: (() => void) | undefined
    private _lastRefreshTimestamp: number | undefined

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
                this._startRefreshInterval()
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
                        this._startRefreshInterval()
                    })
                    return
                }

                this._onRemoteConfig(config)
                this._startRefreshInterval()
            })
        } catch (error) {
            logger.error('Error loading remote config', error)
        }
    }

    stop(): void {
        if (this._refreshInterval) {
            clearInterval(this._refreshInterval)
            this._refreshInterval = undefined
        }
        if (this._onVisibilityChangeHandler && document) {
            document?.removeEventListener?.('visibilitychange', this._onVisibilityChangeHandler)
            this._onVisibilityChangeHandler = undefined
        }
    }

    /**
     * Refresh feature flags for long-running sessions.
     * Calls reloadFeatureFlags() directly rather than re-fetching config — the initial
     * config load already determined whether flags are enabled, and reloadFeatureFlags()
     * is a no-op when flags are disabled. This avoids an unnecessary network round-trip.
     */
    refresh(): void {
        if (this._instance._shouldDisableFlags()) {
            return
        }

        this._lastRefreshTimestamp = Date.now()
        // reloadFeatureFlags() debounces internally, so rapid calls from tab
        // switching or overlapping intervals are safe.
        this._instance.featureFlags.reloadFeatureFlags()
    }

    private _startRefreshInterval(): void {
        if (this._refreshInterval || this._onVisibilityChangeHandler) {
            return
        }

        this._lastRefreshTimestamp = Date.now()

        this._onVisibilityChangeHandler = () => {
            if (this._refreshInterval) {
                clearInterval(this._refreshInterval)
                this._refreshInterval = undefined
            }

            if (document?.visibilityState !== 'hidden') {
                // If the tab was backgrounded long enough that we missed a refresh,
                // fire one immediately so returning users get fresh flags.
                const elapsed = Date.now() - (this._lastRefreshTimestamp ?? 0)
                if (elapsed >= REFRESH_INTERVAL) {
                    this.refresh()
                }

                this._refreshInterval = setInterval(() => {
                    this.refresh()
                }, REFRESH_INTERVAL)
            }
        }

        // Start interval if page is currently visible
        this._onVisibilityChangeHandler()

        // Listen for visibility changes to pause/resume
        if (document) {
            addEventListener(document, 'visibilitychange', this._onVisibilityChangeHandler)
        }
    }

    private _onRemoteConfig(config?: RemoteConfig): void {
        if (!config) {
            logger.error('Failed to fetch remote config from PostHog.')
        }

        // Config and flags are loaded separately: config from /array/{token}/config,
        // flags from /flags/?v=2. Features like surveys, session recording, and product
        // tours reference flags in their config (e.g. survey.linked_flag_key), but this
        // is safe because those flag checks happen lazily at runtime (e.g. when deciding
        // whether to show a survey), not during config processing. By the time a linked
        // flag is evaluated, flags have already loaded.
        //
        // Even when config fails, we pass an empty object so extensions (autocapture,
        // session recording, etc.) still initialize with their defaults.
        this._instance._onRemoteConfig(config ?? ({} as RemoteConfig))

        if (config?.hasFeatureFlags !== false) {
            if (!this._instance.config.advanced_disable_feature_flags_on_first_load) {
                this._instance.featureFlags.ensureFlagsLoaded()
            }
        }
    }
}
