import { PostHog } from '../../posthog-core'
import { DecideResponse } from '../../types'
import { logger } from '../../utils/logger'
import { isBoolean, isObject } from '../../utils/type-utils'
import { WEB_VITALS_ENABLED_SERVER_SIDE } from '../../constants'
import { loadScript } from '../../utils'
import { assignableWindow, window } from '../../utils/globals'
import Config from '../../config'

const LOGGER_PREFIX = '[Web Vitals]'

type WebVitalsEventBuffer = any[] | undefined

export class WebVitalsAutocapture {
    private _enabledServerSide: boolean = false
    private _initialized = false

    // TODO: Periodically flush this if no other event has taken care of it
    private buffer: WebVitalsEventBuffer

    constructor(private readonly instance: PostHog) {
        this._enabledServerSide = !!this.instance.persistence?.props[WEB_VITALS_ENABLED_SERVER_SIDE]
        this.startIfEnabled()
    }

    public getAndClearBuffer(): WebVitalsEventBuffer {
        const buffer = this.buffer
        this.buffer = undefined
        return buffer
    }

    public get isEnabled(): boolean {
        const clientConfig = isObject(this.instance.config.capture_performance)
            ? this.instance.config.capture_performance.web_vitals
            : undefined
        return isBoolean(clientConfig) ? clientConfig : this._enabledServerSide
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

    private _capture = (metric: any) => {
        const sessionIds = this.instance.sessionManager?.checkAndGetSessionAndWindowId(true)
        if (!sessionIds) {
            logger.error(LOGGER_PREFIX + 'Could not read session ID. Dropping metrics!')
            return
        }

        this.buffer = this.buffer || []

        this.buffer.push({
            ...metric,
            $current_url: this._currentURL(),
            $session_id: sessionIds.sessionId,
            $window_id: sessionIds.windowId,
            timestamp: Date.now(),
        })
    }

    private startCapturing = () => {
        const { onLCP, onCLS, onFCP, onINP } = assignableWindow.postHogWebVitalsCallbacks

        // register performance observers
        onLCP(this._capture)
        onCLS(this._capture)
        onFCP(this._capture)
        onINP(this._capture)

        this._initialized = true
    }
}
