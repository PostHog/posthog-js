import { PostHog } from '../../posthog-core'
import { RemoteConfig, SupportedWebVitalsMetrics } from '../../types'
import { createLogger } from '../../utils/logger'
import { isBoolean, isNullish, isNumber, isUndefined, isObject } from '@posthog/core'
import { WEB_VITALS_ALLOWED_METRICS, WEB_VITALS_ENABLED_SERVER_SIDE } from '../../constants'
import { assignableWindow, window, location } from '../../utils/globals'
import { maskQueryParams } from '../../utils/request-utils'
import { PERSONAL_DATA_CAMPAIGN_PARAMS, MASKED } from '../../utils/event-utils'
import { extendArray } from '../../utils'

const logger = createLogger('[Web Vitals]')

type WebVitalsMetricCallback = (metric: any) => void

export const DEFAULT_FLUSH_TO_CAPTURE_TIMEOUT_MILLISECONDS = 5000
const ONE_MINUTE_IN_MILLIS = 60 * 1000
export const FIFTEEN_MINUTES_IN_MILLIS = 15 * ONE_MINUTE_IN_MILLIS

type WebVitalsEventBuffer = { url: string | undefined; metrics: any[]; firstMetricTimestamp: number | undefined }

export class WebVitalsAutocapture {
    private _enabledServerSide: boolean = false
    private _initialized = false

    private _buffer: WebVitalsEventBuffer = { url: undefined, metrics: [], firstMetricTimestamp: undefined }
    private _delayedFlushTimer: ReturnType<typeof setTimeout> | undefined

    constructor(private readonly _instance: PostHog) {
        this._enabledServerSide = !!this._instance.persistence?.props[WEB_VITALS_ENABLED_SERVER_SIDE]

        this.startIfEnabled()
    }

    public get allowedMetrics(): SupportedWebVitalsMetrics[] {
        const clientConfigMetricAllowList: SupportedWebVitalsMetrics[] | undefined = isObject(
            this._instance.config.capture_performance
        )
            ? this._instance.config.capture_performance?.web_vitals_allowed_metrics
            : undefined
        return !isUndefined(clientConfigMetricAllowList)
            ? clientConfigMetricAllowList
            : this._instance.persistence?.props[WEB_VITALS_ALLOWED_METRICS] || ['CLS', 'FCP', 'INP', 'LCP']
    }

    public get flushToCaptureTimeoutMs(): number {
        const clientConfig: number | undefined = isObject(this._instance.config.capture_performance)
            ? this._instance.config.capture_performance.web_vitals_delayed_flush_ms
            : undefined
        return clientConfig || DEFAULT_FLUSH_TO_CAPTURE_TIMEOUT_MILLISECONDS
    }

    public get _maxAllowedValue(): number {
        const configured =
            isObject(this._instance.config.capture_performance) &&
            isNumber(this._instance.config.capture_performance.__web_vitals_max_value)
                ? this._instance.config.capture_performance.__web_vitals_max_value
                : FIFTEEN_MINUTES_IN_MILLIS
        // you can set to 0 to disable the check or any value over ten seconds
        // 1 milli to 1 minute will be set to 15 minutes, cos that would be a silly low maximum
        return 0 < configured && configured <= ONE_MINUTE_IN_MILLIS ? FIFTEEN_MINUTES_IN_MILLIS : configured
    }

    public get isEnabled(): boolean {
        // Always disable web vitals if we're not on http or https
        const protocol = location?.protocol
        if (protocol !== 'http:' && protocol !== 'https:') {
            logger.info('Web Vitals are disabled on non-http/https protocols')
            return false
        }

        // Otherwise, check config
        const clientConfig = isObject(this._instance.config.capture_performance)
            ? this._instance.config.capture_performance.web_vitals
            : isBoolean(this._instance.config.capture_performance)
              ? this._instance.config.capture_performance
              : undefined
        return isBoolean(clientConfig) ? clientConfig : this._enabledServerSide
    }

    public startIfEnabled(): void {
        if (this.isEnabled && !this._initialized) {
            logger.info('enabled, starting...')
            this._loadScript(this._startCapturing)
        }
    }

    public onRemoteConfig(response: RemoteConfig) {
        const webVitalsOptIn = isObject(response.capturePerformance) && !!response.capturePerformance.web_vitals

        const allowedMetrics = isObject(response.capturePerformance)
            ? response.capturePerformance.web_vitals_allowed_metrics
            : undefined

        if (this._instance.persistence) {
            this._instance.persistence.register({
                [WEB_VITALS_ENABLED_SERVER_SIDE]: webVitalsOptIn,
            })

            this._instance.persistence.register({
                [WEB_VITALS_ALLOWED_METRICS]: allowedMetrics,
            })
        }
        // store this in-memory in case persistence is disabled
        this._enabledServerSide = webVitalsOptIn

        this.startIfEnabled()
    }

    private _loadScript(cb: () => void): void {
        if (assignableWindow.__PosthogExtensions__?.postHogWebVitalsCallbacks) {
            // already loaded
            cb()
        }
        assignableWindow.__PosthogExtensions__?.loadExternalDependency?.(this._instance, 'web-vitals', (err) => {
            if (err) {
                logger.error('failed to load script', err)
                return
            }
            cb()
        })
    }

    private _currentURL(): string | undefined {
        const href = window ? window.location.href : undefined
        if (!href) {
            logger.error('Could not determine current URL')
            return undefined
        }

        // mask url query params
        const maskPersonalDataProperties = this._instance.config.mask_personal_data_properties
        const customPersonalDataProperties = this._instance.config.custom_personal_data_properties

        const paramsToMask = maskPersonalDataProperties
            ? extendArray([], PERSONAL_DATA_CAMPAIGN_PARAMS, customPersonalDataProperties || [])
            : []

        return maskQueryParams(href, paramsToMask, MASKED)
    }

    private _flushToCapture = () => {
        clearTimeout(this._delayedFlushTimer)
        if (this._buffer.metrics.length === 0) {
            return
        }

        this._instance.capture(
            '$web_vitals',
            this._buffer.metrics.reduce(
                (acc, metric) => ({
                    ...acc,
                    // the entire event so we can use it in the future e.g. includes google's rating
                    [`$web_vitals_${metric.name}_event`]: { ...metric },
                    [`$web_vitals_${metric.name}_value`]: metric.value,
                }),
                {}
            )
        )
        this._buffer = { url: undefined, metrics: [], firstMetricTimestamp: undefined }
    }

    private _addToBuffer = (metric: any) => {
        const sessionIds = this._instance.sessionManager?.checkAndGetSessionAndWindowId(true)
        if (isUndefined(sessionIds)) {
            logger.error('Could not read session ID. Dropping metrics!')
            return
        }

        this._buffer = this._buffer || { url: undefined, metrics: [], firstMetricTimestamp: undefined }

        const $currentUrl = this._currentURL()
        if (isUndefined($currentUrl)) {
            return
        }

        if (isNullish(metric?.name) || isNullish(metric?.value)) {
            logger.error('Invalid metric received', metric)
            return
        }

        // we observe some very large values sometimes, we'll ignore them
        // since the likelihood of LCP > 1 hour being correct is very low
        if (this._maxAllowedValue && metric.value >= this._maxAllowedValue) {
            logger.error('Ignoring metric with value >= ' + this._maxAllowedValue, metric)
            return
        }

        const urlHasChanged = this._buffer.url !== $currentUrl

        if (urlHasChanged) {
            // we need to send what we have
            this._flushToCapture()
            // poor performance is >4s, we wait twice that time to send
            // this is in case we haven't received all metrics
            // we'll at least gather some
            this._delayedFlushTimer = setTimeout(this._flushToCapture, this.flushToCaptureTimeoutMs)
        }

        if (isUndefined(this._buffer.url)) {
            this._buffer.url = $currentUrl
        }

        this._buffer.firstMetricTimestamp = isUndefined(this._buffer.firstMetricTimestamp)
            ? Date.now()
            : this._buffer.firstMetricTimestamp

        if (metric.attribution && metric.attribution.interactionTargetElement) {
            // we don't want to send the entire element
            // they can be very large
            // TODO we could run this through autocapture code so that we get elements chain info
            //  and can display the element in the UI
            metric.attribution.interactionTargetElement = undefined
        }

        this._buffer.metrics.push({
            ...metric,
            $current_url: $currentUrl,
            $session_id: sessionIds.sessionId,
            $window_id: sessionIds.windowId,
            timestamp: Date.now(),
        })

        if (this._buffer.metrics.length === this.allowedMetrics.length) {
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
            logger.error('web vitals callbacks not loaded - not starting')
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
