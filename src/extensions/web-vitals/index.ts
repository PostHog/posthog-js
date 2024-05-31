import { PostHog } from '../../posthog-core'
import { DecideResponse } from '../../types'
import { logger } from '../../utils/logger'
import { isObject } from '../../utils/type-utils'
import { WEB_VITALS_ENABLED_SERVER_SIDE } from '../../constants'
import { loadScript } from '../../utils'
import { assignableWindow, window } from '../../utils/globals'
import Config from '../../config'

import { PassengerEvents } from '../passenger-events'

const LOGGER_PREFIX = '[Web Vitals]'

type WebVitalsEventBuffer = any[]

export class WebVitalsAutocapture extends PassengerEvents<WebVitalsEventBuffer> {
    constructor(instance: PostHog) {
        super(
            instance,
            'web-vitals',
            (x) => (isObject(x.config.capture_performance) ? x.config.capture_performance.web_vitals : undefined),
            WEB_VITALS_ENABLED_SERVER_SIDE
        )
        this.startIfEnabled()
    }

    protected onStart(): void {
        this.loadScript(this.startCapturing)
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
        if ((window as any).postHogWebVitalsCallbacks) {
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

    private _currentURL(): string | undefined {
        // TODO you should be able to mask the URL here
        const href = window ? window.location.href : undefined
        if (!href) {
            logger.error(LOGGER_PREFIX + 'Could not determine current URL')
        }
        return href
    }

    private _capture(metric: any) {
        const sessionIds = this.instance.sessionManager?.checkAndGetSessionAndWindowId(true)
        if (!sessionIds) {
            logger.error(LOGGER_PREFIX + 'Could not determine session IDs. Dropping metrics')
            return
        }

        this.buffer = this.buffer || []

        this.buffer.push({
            ...metric,
            $current_url: this._currentURL(),
            $session_id: sessionIds.sessionId,
            timestamp: Date.now(),
        })
    }

    private startCapturing = () => {
        const { onLCP, onCLS, onFCP, onINP } = assignableWindow.postHogWebVitalsCallbacks

        // register performance observers
        const captureMetric = (metric: any) => this._capture(metric)
        onLCP(captureMetric)
        onCLS(captureMetric)
        onFCP(captureMetric)
        onINP(captureMetric)

        this._initialized = true
    }
}
