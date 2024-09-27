import { DecideResponse } from '../types'
import { PostHog } from '../posthog-core'

import { HEATMAPS_ENABLED_SERVER_SIDE } from '../constants'
import { isUndefined } from '../utils/type-utils'
import { assignableWindow } from '../utils/globals'
import { logger } from '../utils/logger'

export interface LazyExtension {
    startIfEnabled(): void
    afterDecideResponse(response: DecideResponse): void
}

const HEATMAPS = 'heatmaps'
export const LOGGER_PREFIX = '[' + HEATMAPS + ']'

export class Heatmaps implements LazyExtension {
    instance: PostHog
    private _enabledServerSide: boolean
    private _heatmapsAutocapture?: LazyExtension

    constructor(instance: PostHog) {
        this.instance = instance
        this._enabledServerSide = !!this.instance.persistence?.props[HEATMAPS_ENABLED_SERVER_SIDE]
    }

    public get isEnabled(): boolean {
        if (!isUndefined(this.instance.config.capture_heatmaps)) {
            return this.instance.config.capture_heatmaps !== false
        }
        if (!isUndefined(this.instance.config.enable_heatmaps)) {
            return this.instance.config.enable_heatmaps
        }
        return this._enabledServerSide
    }

    public startIfEnabled(): void {
        if (this.isEnabled) {
            if (!this._heatmapsAutocapture) {
                assignableWindow.__PosthogExtensions__?.loadExternalDependency?.(this.instance, 'heatmaps', (err) => {
                    if (err) {
                        return logger.error(LOGGER_PREFIX + ` could not load recorder`, err)
                    }

                    this._onScriptLoaded()
                })
            } else {
                this._onScriptLoaded()
            }
        }
    }

    public afterDecideResponse(response: DecideResponse) {
        const optIn = !!response['heatmaps']

        if (this.instance.persistence) {
            this.instance.persistence.register({
                [HEATMAPS_ENABLED_SERVER_SIDE]: optIn,
            })
        }
        // store this in-memory in case persistence is disabled
        this._enabledServerSide = optIn
        this.startIfEnabled()
    }

    private _onScriptLoaded() {
        this._heatmapsAutocapture = assignableWindow.__PosthogExtensions__?.HeatmapsAutocapture?.(this.instance)
        if (this._heatmapsAutocapture) {
            this._heatmapsAutocapture.startIfEnabled()
        }
    }
}
