import { PostHog } from '../../posthog-core'
import { DecideResponse } from '../../types'
import { logger } from '../../utils/logger'
import { isObject } from '../../utils/type-utils'
import { WEB_VITALS_ENABLED_SERVER_SIDE } from '../../constants'
import { loadScript } from '../../utils'
import { window } from '../../utils/globals'
import Config from '../../config'

const LOGGER_PREFIX = '[Web Vitals]'

export const extendPostHog = (instance: PostHog, response: DecideResponse) => {
    const webVitalsAutocapture = new WebVitalsAutocapture(instance)
    webVitalsAutocapture.afterDecideResponse(response)
    return webVitalsAutocapture
}

export class WebVitalsAutocapture {
    private _enabledServerSide: boolean = false
    private _initialized = false

    constructor(private readonly instance: PostHog) {
        //todo what downloads the script?
        this._enabledServerSide = !!this.instance.persistence?.props[WEB_VITALS_ENABLED_SERVER_SIDE]
        this.startIfEnabled()
    }

    public get isEnabled(): boolean {
        return isObject(this.instance.config.capture_performance) && this.instance.config.capture_performance.web_vitals
            ? this.instance.config.capture_performance.web_vitals
            : this._enabledServerSide
    }

    public startIfEnabled(): void {
        if (this.isEnabled && !this._initialized) {
            logger.info(LOGGER_PREFIX + ' enabled, starting...')
            this.loadScript(this.startCapturing)
        }
    }

    public afterDecideResponse(response: DecideResponse) {
        const webVitalsOptIn = isObject(response.capturePerformance) && !!response.capturePerformance.web_vitals

        if (this.instance.persistence) {
            this.instance.persistence.register({
                [WEB_VITALS_ENABLED_SERVER_SIDE]: webVitalsOptIn,
            })
        }
        // store this in-memory in case persistence is disabled
        this._enabledServerSide = webVitalsOptIn

        this.startIfEnabled()
    }

    private loadScript(cb: () => void): void {
        if ((window as any).extendPostHogWithWebVitals) {
            // already loaded
            cb()
        }

        loadScript(
            this.instance.requestRouter.endpointFor('assets', `/static/web-vitals.js?v=${Config.LIB_VERSION}`),
            (err) => {
                if (err) {
                    logger.error(LOGGER_PREFIX + ' failed to load script', err)
                }
                cb()
            }
        )
    }

    private startCapturing() {}
}
