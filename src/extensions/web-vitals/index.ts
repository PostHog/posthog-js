import { PostHog } from '../../posthog-core'
import { DecideResponse, SupportedWebVitalsMetrics } from '../../types'
import { logger } from '../../utils/logger'
import { isBoolean, isNullish, isNumber, isObject, isUndefined } from '../../utils/type-utils'
import { WEB_VITALS_ALLOWED_METRICS, WEB_VITALS_ENABLED_SERVER_SIDE } from '../../constants'
import { assignableWindow, window } from '../../utils/globals'

type WebVitalsMetricCallback = (metric: any) => void

export const FLUSH_TO_CAPTURE_TIMEOUT_MILLISECONDS = 8000
const ONE_MINUTE_IN_MILLIS = 60 * 1000
export const FIFTEEN_MINUTES_IN_MILLIS = 15 * ONE_MINUTE_IN_MILLIS

const LOGGER_PREFIX = '[Web Vitals]'
type WebVitalsEventBuffer = { url: string | undefined; metrics: any[]; firstMetricTimestamp: number | undefined }

export class WebVitalsAutocapture {
    private _enabledServerSide: boolean = false
    private _initialized = false

    private buffer: WebVitalsEventBuffer = { url: undefined, metrics: [], firstMetricTimestamp: undefined }
    private _delayedFlushTimer: ReturnType<typeof setTimeout> | undefined

    constructor(private readonly instance: PostHog) {
        this._enabledServerSide = !!this.instance.persistence?.props[WEB_VITALS_ENABLED_SERVER_SIDE]

        this.startIfEnabled()
    }

    public get allowedMetrics(): SupportedWebVitalsMetrics[] {
        const clientConfigMetricAllowList: SupportedWebVitalsMetrics[] | undefined = isObject(
            this.instance.config.capture_performance
        )
            ? this.instance.config.capture_performance?.web_vitals_allowed_metrics
            : undefined
        return !isUndefined(clientConfigMetricAllowList)
            ? clientConfigMetricAllowList
            : this.instance.persistence?.props[WEB_VITALS_ALLOWED_METRICS] || ['CLS', 'FCP', 'INP', 'LCP']
    }

    public get _maxAllowedValue(): number {
        const configured =
            isObject(this.instance.config.capture_performance) &&
            isNumber(this.instance.config.capture_performance.__web_vitals_max_value)
                ? this.instance.config.capture_performance.__web_vitals_max_value
                : FIFTEEN_MINUTES_IN_MILLIS
        // you can set to 0 to disable the check or any value over ten seconds
        // 1 milli to 1 minute will be set to 15 minutes, cos that would be a silly low maximum
        return 0 < configured && configured <= ONE_MINUTE_IN_MILLIS ? FIFTEEN_MINUTES_IN_MILLIS : configured
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

        const allowedMetrics = isObject(response.capturePerformance)
            ? response.capturePerformance.web_vitals_allowed_metrics
            : undefined

        if (this.instance.persistence) {
            this.instance.persistence.register({
                [WEB_VITALS_ENABLED_SERVER_SIDE]: webVitalsOptIn,
            })

            this.instance.persistence.register({
                [WEB_VITALS_ALLOWED_METRICS]: allowedMetrics,
            })
        }
        // store this in-memory in case persistence is disabled
        this._enabledServerSide = webVitalsOptIn

        this.startIfEnabled()
    }

    private loadScript(cb: () => void): void {
        if (assignableWindow.__PosthogExtensions__?.postHogWebVitalsCallbacks) {
            // already loaded
            cb()
        }
        assignableWindow.__PosthogExtensions__?.loadExternalDependency?.(this.instance, 'web-vitals', (err) => {
            if (err) {
                logger.error(LOGGER_PREFIX + ' failed to load script', err)
                return
            }
            cb()
        })
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

        this.buffer = this.buffer || { url: undefined, metrics: [], firstMetricTimestamp: undefined }

        const $currentUrl = this._currentURL()
        if (isUndefined($currentUrl)) {
            return
        }

        if (isNullish(metric?.name) || isNullish(metric?.value)) {
            logger.error(LOGGER_PREFIX + 'Invalid metric received', metric)
            return
        }

        // we observe some very large values sometimes, we'll ignore them
        // since the likelihood of LCP > 1 hour being correct is very low
        if (this._maxAllowedValue && metric.value >= this._maxAllowedValue) {
            logger.error(LOGGER_PREFIX + 'Ignoring metric with value >= ' + this._maxAllowedValue, metric)
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

        if (this.buffer.metrics.length === this.allowedMetrics.length) {
            // we have all allowed metrics
            this._flushToCapture()
        }
    }

    private _startCapturing = () => {
        let onLCP: WebVitalsMetricCallback | undefined
        let onCLS: WebVitalsMetricCallback | undefined
        let onFCP: WebVitalsMetricCallback | undefined
        let onINP: WebVitalsMetricCallback | undefined

        const posthogExtensions = assignableWindow.__PosthogExtensions__
        if (!isUndefined(posthogExtensions) && !isUndefined(posthogExtensions.postHogWebVitalsCallbacks)) {
            ;({ onLCP, onCLS, onFCP, onINP } = posthogExtensions.postHogWebVitalsCallbacks)
        }

        if (!onLCP || !onCLS || !onFCP || !onINP) {
            logger.error(LOGGER_PREFIX + 'web vitals callbacks not loaded - not starting')
            return
        }

        // register performance observers
        if (this.allowedMetrics.indexOf('LCP') > -1) {
            onLCP(this._addToBuffer.bind(this))
        }
        if (this.allowedMetrics.indexOf('CLS') > -1) {
            onCLS(this._addToBuffer.bind(this))
        }
        if (this.allowedMetrics.indexOf('FCP') > -1) {
            onFCP(this._addToBuffer.bind(this))
        }
        if (this.allowedMetrics.indexOf('INP') > -1) {
            onINP(this._addToBuffer.bind(this))
        }

        this._initialized = true
    }
}
