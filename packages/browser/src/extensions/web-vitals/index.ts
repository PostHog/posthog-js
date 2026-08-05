import { PostHog } from '../../posthog-core'
import { PostHogConfig, RemoteConfigResult, SupportedWebVitalsMetrics } from '../../types'
import { createLogger } from '@posthog/browser-common/utils/logger'
import { isBoolean, isNullish, isNumber, isUndefined, isObject, stripUrlHash } from '@posthog/core'
import { WEB_VITALS_ALLOWED_METRICS, WEB_VITALS_ENABLED_SERVER_SIDE } from '../../constants'
import { window, location } from '@posthog/browser-common/utils/globals'
import { assignableWindow, WebVitalsCallbackFlavor, WebVitalsReportOpts } from '../../utils/globals'
import { maskQueryParams } from '@posthog/browser-common/utils/request-utils'
import { PERSONAL_DATA_CAMPAIGN_PARAMS, MASKED } from '@posthog/browser-common/utils/event-utils'

const logger = createLogger('[Web Vitals]')

// the metric observer registration function from the web-vitals library (onLCP, onCLS, ...).
// it takes the report callback plus an optional ReportOpts (e.g. `reportSoftNavs`).
type WebVitalsMetricCallback = (onReport: (metric: any) => void, opts?: WebVitalsReportOpts) => void

export const DEFAULT_FLUSH_TO_CAPTURE_TIMEOUT_MILLISECONDS = 5000
const ONE_MINUTE_IN_MILLIS = 60 * 1000
export const FIFTEEN_MINUTES_IN_MILLIS = 15 * ONE_MINUTE_IN_MILLIS

type WebVitalsEventBuffer = {
    navigationKey: string | undefined
    url: string | undefined
    metrics: any[]
    firstMetricTimestamp: number | undefined
}

export class WebVitalsAutocapture {
    private _enabledServerSide: boolean = false
    private _initialized = false

    private _buffer: WebVitalsEventBuffer = {
        navigationKey: undefined,
        url: undefined,
        metrics: [],
        firstMetricTimestamp: undefined,
    }
    private _delayedFlushTimer: ReturnType<typeof setTimeout> | undefined

    constructor(private readonly _instance: PostHog) {
        this._enabledServerSide = !!this._instance.persistence?.props[WEB_VITALS_ENABLED_SERVER_SIDE]

        this.startIfEnabled()
    }

    private get _perfConfig(): PostHogConfig['capture_performance'] {
        return this._instance.config.capture_performance
    }

    public get allowedMetrics(): SupportedWebVitalsMetrics[] {
        const clientConfigMetricAllowList: SupportedWebVitalsMetrics[] | undefined = isObject(this._perfConfig)
            ? this._perfConfig?.web_vitals_allowed_metrics
            : undefined
        return !isNullish(clientConfigMetricAllowList)
            ? clientConfigMetricAllowList
            : this._instance.persistence?.props[WEB_VITALS_ALLOWED_METRICS] || ['CLS', 'FCP', 'INP', 'LCP']
    }

    public get flushToCaptureTimeoutMs(): number {
        const clientConfig: number | undefined = isObject(this._perfConfig)
            ? this._perfConfig.web_vitals_delayed_flush_ms
            : undefined
        return clientConfig || DEFAULT_FLUSH_TO_CAPTURE_TIMEOUT_MILLISECONDS
    }

    public get useAttribution(): boolean {
        const clientConfig: boolean | undefined = isObject(this._perfConfig)
            ? this._perfConfig.web_vitals_attribution
            : undefined
        return clientConfig ?? false
    }

    public get useSoftNavs(): boolean {
        const clientConfig: boolean | undefined = isObject(this._perfConfig)
            ? this._perfConfig.__preview_web_vitals_soft_navs
            : undefined
        return clientConfig ?? false
    }

    public get _maxAllowedValue(): number {
        const configured =
            isObject(this._perfConfig) && isNumber(this._perfConfig.__web_vitals_max_value)
                ? this._perfConfig.__web_vitals_max_value
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
        const clientConfig = isObject(this._perfConfig)
            ? this._perfConfig.web_vitals
            : isBoolean(this._perfConfig)
              ? this._perfConfig
              : undefined
        return isBoolean(clientConfig) ? clientConfig : this._enabledServerSide
    }

    public startIfEnabled(): void {
        if (this.isEnabled && !this._initialized) {
            logger.info('enabled, starting...')
            this._loadScript(this._startCapturing)
        }
    }

    public onRemoteConfig(result: RemoteConfigResult) {
        if (!result.ok) {
            // Failure behaves like a response without a capturePerformance key.
            return
        }

        const response = result.config
        if (!('capturePerformance' in response)) {
            return
        }

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

    private get _callbackFlavor(): WebVitalsCallbackFlavor {
        return this.useSoftNavs
            ? this.useAttribution
                ? 'web-vitals-with-attribution-soft-navs'
                : 'web-vitals-soft-navs'
            : this.useAttribution
              ? 'web-vitals-with-attribution'
              : 'web-vitals'
    }

    private _loadScript(cb: () => void): void {
        const posthogExtensions = assignableWindow.__PosthogExtensions__
        const flavor = this._callbackFlavor
        const callbacksByFlavor = posthogExtensions?.postHogWebVitalsCallbacksByFlavor
        if (
            callbacksByFlavor?.[flavor] ||
            (flavor === 'web-vitals' && isUndefined(callbacksByFlavor) && posthogExtensions?.postHogWebVitalsCallbacks)
        ) {
            cb()
            return
        }

        posthogExtensions?.loadExternalDependency?.(this._instance, flavor, (err) => {
            if (err) {
                logger.error('failed to load script', err)
                return
            }

            cb()
        })
    }

    private _maskedURL(url?: string): string | undefined {
        const href = url || window?.location.href
        if (!href) {
            logger.error('Could not determine current URL')
            return undefined
        }

        const urlWithoutHash = this._instance.config.disable_capture_url_hashes ? stripUrlHash(href) : href

        // mask url query params
        const maskPersonalDataProperties = this._instance.config.mask_personal_data_properties
        const customPersonalDataProperties = this._instance.config.custom_personal_data_properties

        const paramsToMask = maskPersonalDataProperties
            ? [...PERSONAL_DATA_CAMPAIGN_PARAMS, ...(customPersonalDataProperties || [])]
            : []

        return maskQueryParams(urlWithoutHash, paramsToMask, MASKED)
    }

    private _flushToCapture = () => {
        clearTimeout(this._delayedFlushTimer)
        this._delayedFlushTimer = undefined
        if (this._buffer.metrics.length === 0) {
            return
        }

        this._instance.capture('$web_vitals', {
            $current_url: this._buffer.url,
            ...this._buffer.metrics.reduce(
                (acc, metric) => ({
                    ...acc,
                    // the entire event so we can use it in the future e.g. includes google's rating
                    [`$web_vitals_${metric.name}_event`]: { ...metric },
                    [`$web_vitals_${metric.name}_value`]: metric.value,
                }),
                {}
            ),
        })
        this._buffer = { navigationKey: undefined, url: undefined, metrics: [], firstMetricTimestamp: undefined }
    }

    private _addToBuffer = (metric: any) => {
        this._buffer = this._buffer || {
            navigationKey: undefined,
            url: undefined,
            metrics: [],
            firstMetricTimestamp: undefined,
        }

        if (isNullish(metric?.name) || isNullish(metric?.value)) {
            logger.error('Invalid metric received', metric)
            return
        }

        const navigationURL = typeof metric.navigationURL === 'string' ? metric.navigationURL : undefined
        const $currentUrl = this._maskedURL(navigationURL)
        if (isUndefined($currentUrl)) {
            return
        }
        const hasNavigationId = isNumber(metric.navigationId) || typeof metric.navigationId === 'string'
        const navigationKey = hasNavigationId ? `navigation:${metric.navigationId}` : `url:${$currentUrl}`

        // we observe some very large values sometimes, we'll ignore them
        // since the likelihood of LCP > 1 hour being correct is very low
        if (this._maxAllowedValue && metric.value >= this._maxAllowedValue) {
            logger.error('Ignoring metric with value >= ' + this._maxAllowedValue, metric)
            return
        }

        const navigationHasChanged = this._buffer.navigationKey !== navigationKey

        if (navigationHasChanged) {
            // we need to send what we have
            this._flushToCapture()

            // poor performance is >4s, we wait twice that time to send
            // this is in case we haven't received all metrics
            // we'll at least gather some
            this._delayedFlushTimer = setTimeout(this._flushToCapture, this.flushToCaptureTimeoutMs)
        }

        if (isUndefined(this._buffer.navigationKey)) {
            this._buffer.navigationKey = navigationKey
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

        const sessionIds = this._instance.sessionManager?.checkAndGetSessionAndWindowId(true)
        const bufferedMetric: Record<string, unknown> = {
            ...metric,
            ...(navigationURL ? { navigationURL: $currentUrl } : {}),
            $current_url: $currentUrl,
            timestamp: Date.now(),
        }
        if (!isUndefined(sessionIds)) {
            bufferedMetric.$session_id = sessionIds.sessionId
            bufferedMetric.$window_id = sessionIds.windowId
        }

        this._buffer.metrics.push(bufferedMetric)

        if (this._buffer.metrics.length === this.allowedMetrics.length) {
            // we have all allowed metrics
            this._flushToCapture()
        }
    }

    private _startCapturing = () => {
        // IMPORTANT: web-vitals does not provide cleanup functions and warns against
        // calling functions more than once per page load. Each call creates new
        // PerformanceObservers that persist for the page lifetime.
        // See: https://github.com/GoogleChrome/web-vitals/issues/629
        if (this._initialized) {
            return
        }

        let onLCP: WebVitalsMetricCallback | undefined
        let onCLS: WebVitalsMetricCallback | undefined
        let onFCP: WebVitalsMetricCallback | undefined
        let onINP: WebVitalsMetricCallback | undefined

        const posthogExtensions = assignableWindow.__PosthogExtensions__
        const callbacksByFlavor = posthogExtensions?.postHogWebVitalsCallbacksByFlavor
        const callbacks =
            callbacksByFlavor?.[this._callbackFlavor] ||
            (this._callbackFlavor === 'web-vitals' && isUndefined(callbacksByFlavor)
                ? posthogExtensions?.postHogWebVitalsCallbacks
                : undefined)
        if (!isUndefined(callbacks)) {
            ;({ onLCP, onCLS, onFCP, onINP } = callbacks)
        }

        if (!onLCP || !onCLS || !onFCP || !onINP) {
            logger.error('web vitals callbacks not loaded - not starting')
            return
        }

        // Scope metrics to the browser's Soft Navigation entries when opted in, so SPA
        // route changes don't keep inflating the metric against the original hard navigation.
        const reportOpts: WebVitalsReportOpts = { reportSoftNavs: this.useSoftNavs }

        // register performance observers
        if (this.allowedMetrics.indexOf('LCP') > -1) {
            onLCP(this._addToBuffer.bind(this), reportOpts)
        }
        if (this.allowedMetrics.indexOf('CLS') > -1) {
            onCLS(this._addToBuffer.bind(this), reportOpts)
        }
        if (this.allowedMetrics.indexOf('FCP') > -1) {
            onFCP(this._addToBuffer.bind(this), reportOpts)
        }
        if (this.allowedMetrics.indexOf('INP') > -1) {
            onINP(this._addToBuffer.bind(this), reportOpts)
        }

        this._initialized = true
    }
}
