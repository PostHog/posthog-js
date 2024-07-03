import { PostHog } from '../../posthog-core'
import { DecideResponse } from '../../types'
import { logger } from '../../utils/logger'
import { isBoolean, isNullish, isObject, isUndefined } from '../../utils/type-utils'
import { WEB_VITALS_ENABLED_SERVER_SIDE } from '../../constants'
import { assignableWindow, window } from '../../utils/globals'
import Config from '../../config'

export const FLUSH_TO_CAPTURE_TIMEOUT_MILLISECONDS = 8000
const LOGGER_PREFIX = '[Web Vitals]'
type WebVitalsEventBuffer = { url: string | undefined; metrics: any[]; firstMetricTimestamp: number | undefined }

export class WebVitalsAutocapture {
    private _enabledServerSide: boolean = false
    private _initialized = false

    private buffer: WebVitalsEventBuffer = { url: undefined, metrics: [], firstMetricTimestamp: undefined }
    private _delayedFlushTimer: number | undefined

    constructor(private readonly instance: PostHog) {
        this._enabledServerSide = !!this.instance.persistence?.props[WEB_VITALS_ENABLED_SERVER_SIDE]
        this.startIfEnabled()
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
            this.loadScript(this._startCapturing)
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

        this.instance.requestRouter.loadScript(
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

    private _flushToCapture = () => {
        clearTimeout(this._delayedFlushTimer)
        if (this.buffer.metrics.length === 0) {
            return
        }

        this.instance.capture(
            '$web_vitals',
            this.buffer.metrics.reduce(
                (acc, metric) => ({
                    ...acc,
                    // the entire event so we can use it in the future e.g. includes google's rating
                    [`$web_vitals_${metric.name}_event`]: { ...metric },
                    [`$web_vitals_${metric.name}_value`]: metric.value,
                }),
                {}
            )
        )
        this.buffer = { url: undefined, metrics: [], firstMetricTimestamp: undefined }
    }

    private _addToBuffer = (metric: any) => {
        const sessionIds = this.instance.sessionManager?.checkAndGetSessionAndWindowId(true)
        if (isUndefined(sessionIds)) {
            logger.error(LOGGER_PREFIX + 'Could not read session ID. Dropping metrics!')
            return
        }

        this.buffer = this.buffer || {}

        const $currentUrl = this._currentURL()
        if (isUndefined($currentUrl)) {
            return
        }

        if (isNullish(metric?.name) || isNullish(metric?.value)) {
            logger.error(LOGGER_PREFIX + 'Invalid metric received', metric)
            return
        }

        const urlHasChanged = this.buffer.url !== $currentUrl

        if (urlHasChanged) {
            // we need to send what we have
            this._flushToCapture()
            // poor performance is >4s, we wait twice that time to send
            // this is in case we haven't received all metrics
            // we'll at least gather some
            this._delayedFlushTimer = setTimeout(this._flushToCapture, FLUSH_TO_CAPTURE_TIMEOUT_MILLISECONDS)
        }

        if (isUndefined(this.buffer.url)) {
            this.buffer.url = $currentUrl
        }

        this.buffer.firstMetricTimestamp = isUndefined(this.buffer.firstMetricTimestamp)
            ? Date.now()
            : this.buffer.firstMetricTimestamp

        this.buffer.metrics.push({
            ...metric,
            $current_url: $currentUrl,
            $session_id: sessionIds.sessionId,
            $window_id: sessionIds.windowId,
            timestamp: Date.now(),
        })

        if (this.buffer.metrics.length === 4) {
            // we have all 4 metrics
            this._flushToCapture()
        }
    }

    private _startCapturing = () => {
        const { onLCP, onCLS, onFCP, onINP } = assignableWindow.postHogWebVitalsCallbacks

        // register performance observers
        onLCP(this._addToBuffer)
        onCLS(this._addToBuffer)
        onFCP(this._addToBuffer)
        onINP(this._addToBuffer)

        this._initialized = true
    }
}
