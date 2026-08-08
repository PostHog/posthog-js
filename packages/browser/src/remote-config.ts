import { PostHog } from './posthog-core'
import { RemoteConfig } from './types'

import { createLogger } from '@posthog/browser-common/utils/logger'
import { addEventListener } from '@posthog/browser-common/utils/general-utils'
import { document } from '@posthog/browser-common/utils/globals'
import { assignableWindow } from './utils/globals'
import { DOM_EVENT_VISIBILITYCHANGE } from './constants'
import type { RequestResponse } from '@posthog/types'

const logger = createLogger('[RemoteConfig]')

// Default refresh interval for feature flags in long-running sessions.
// 5 minutes balances freshness with server load - flags typically don't change
// frequently, and most sessions are shorter than this anyway.
const DEFAULT_REFRESH_INTERVAL = 5 * 60 * 1000

export class RemoteConfigLoader {
    private _refreshInterval: ReturnType<typeof setInterval> | undefined
    private _visibilityChangeListener: EventListener | undefined
    private _lastRefreshAt: number | undefined

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

    private _loadRemoteConfigJSON(cb: (response: RequestResponse) => void): void {
        this._instance._send_request({
            method: 'GET',
            url: this._instance.requestRouter.endpointFor('assets', `/array/${this._instance.config.token}/config`),
            callback: cb,
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
                    this._loadRemoteConfigJSON((response) => {
                        this._onRemoteConfig(response.json as RemoteConfig | undefined, response)
                        this._startRefreshInterval()
                    })
                    return
                }

                this._onRemoteConfig(config)
                this._startRefreshInterval()
            })
        } catch (error) {
            logger.error('Error loading remote config', error)
            this._onRemoteConfig()
            // Start polling even when the config load fails, so a tab that lost this
            // request still picks up later flag changes instead of holding a stale value.
            this._startRefreshInterval()
        }
    }

    stop(): void {
        if (this._refreshInterval) {
            clearInterval(this._refreshInterval)
            this._refreshInterval = undefined
        }
        if (this._visibilityChangeListener) {
            document?.removeEventListener(DOM_EVENT_VISIBILITYCHANGE, this._visibilityChangeListener)
            this._visibilityChangeListener = undefined
        }
    }

    /**
     * Refresh feature flags for long-running sessions.
     * Calls reloadFeatureFlags() directly rather than re-fetching config — the initial
     * config load already determined whether flags are enabled, and reloadFeatureFlags()
     * is a no-op when flags are disabled. This avoids an unnecessary network round-trip.
     */
    refresh(): void {
        if (this._instance._shouldDisableFlags() || !document || document.visibilityState === 'hidden') {
            return
        }

        this._lastRefreshAt = Date.now()
        this._instance.reloadFeatureFlags()
    }

    private get _refreshIntervalMs(): number {
        return this._instance.config.remote_config_refresh_interval_ms ?? DEFAULT_REFRESH_INTERVAL
    }

    private _startRefreshInterval(): void {
        if (this._refreshInterval) {
            return
        }

        const intervalMs = this._refreshIntervalMs

        // Allow users to disable periodic refresh by setting interval to 0
        if (intervalMs === 0) {
            return
        }

        this._refreshInterval = setInterval(() => {
            this.refresh()
        }, intervalMs)

        this._startVisibilityRefresh()
    }

    /**
     * Refresh flags when a background tab becomes visible again.
     * Browsers throttle background timers hard, so a hidden tab skips every interval tick
     * and then serves the cached flag value until the next tick fires late. This listener
     * closes that gap. The minimum-interval guard (plus the debounce in reloadFeatureFlags)
     * stops a wall of restored tabs from stampeding the /flags endpoint.
     */
    private _startVisibilityRefresh(): void {
        if (this._visibilityChangeListener || !document) {
            return
        }

        this._visibilityChangeListener = () => {
            if (document?.visibilityState !== 'visible') {
                return
            }
            if (Date.now() - (this._lastRefreshAt ?? 0) < this._refreshIntervalMs) {
                return
            }
            this.refresh()
        }

        addEventListener(document, DOM_EVENT_VISIBILITYCHANGE, this._visibilityChangeListener)
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
