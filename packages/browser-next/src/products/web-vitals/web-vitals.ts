import {
    WebVitalsAutocapture,
    type WebVitalsCallbackFlavor,
    type WebVitalsCallbacks,
} from '@posthog/browser-common/web-vitals'
import type { PerformanceCaptureConfig } from '@posthog/types'
import type { BrowserProducts } from '../../core/context/browser-client'
import type { IPostHog } from '../../core/types'
import type { WebVitalsOptions } from './web-vitals-options'

export type { WebVitalsOptions, WebVitalsMetric } from './web-vitals-options'

// The web-vitals library stays in its own lazily loaded chunks, imported only once capture is enabled.
const loadCallbacks = async (flavor: WebVitalsCallbackFlavor): Promise<WebVitalsCallbacks> => {
    const unattributed = flavor === 'web-vitals' || flavor === 'web-vitals-soft-navs'
    const [{ onLCP, onCLS, onFCP, onINP }, attributed] = await Promise.all([
        import('./web-vitals-library'),
        unattributed ? undefined : import('./web-vitals-attribution-library'),
    ])
    const plain = { onLCP, onCLS, onFCP, onINP }
    if (!attributed) return plain
    return {
        onLCP: attributed.onLCP,
        onCLS: attributed.onCLS,
        onFCP: attributed.onFCP,
        onINP: attributed.onINP,
        withoutAttribution: plain,
    }
}

// Map onto the posthog-js `capture_performance` settings the shared implementation reads.
const toPerformanceConfig = (options: WebVitalsOptions): PerformanceCaptureConfig => {
    const { enabled, allowedMetrics, attribution, delayedFlushMs, maxValue, previewSoftNavigations } = options
    return {
        ...(enabled === undefined ? {} : { web_vitals: enabled }),
        ...(allowedMetrics ? { web_vitals_allowed_metrics: [...allowedMetrics] } : {}),
        ...(attribution === undefined
            ? {}
            : {
                  web_vitals_attribution:
                      attribution === true || attribution === false ? attribution : [...attribution],
              }),
        ...(delayedFlushMs === undefined ? {} : { web_vitals_delayed_flush_ms: delayedFlushMs }),
        ...(maxValue === undefined ? {} : { __web_vitals_max_value: maxValue }),
        ...(previewSoftNavigations === undefined ? {} : { __preview_web_vitals_soft_navs: previewSoftNavigations }),
    }
}

/** Include web vitals capture statically instead of loading it when the project enables it. */
export const webVitals = (options: WebVitalsOptions = {}): BrowserProducts['webVitals'] => {
    const config = {
        capture_performance: toPerformanceConfig(options),
        disable_capture_url_hashes: options.disableCaptureUrlHashes ?? true,
        mask_personal_data_properties: options.maskPersonalDataProperties ?? true,
        custom_personal_data_properties: [...(options.customPersonalDataProperties ?? [])],
    }
    let client: IPostHog | undefined
    const shared = new WebVitalsAutocapture({
        getConfig: () => config,
        loadObservers: (getFlavor, onLoad) => {
            loadCallbacks(getFlavor())
                .then(onLoad)
                .catch((error: unknown) => client?.logger.error('[Web Vitals] failed to start', error))
        },
    })
    return {
        name: 'webVitals',
        setup: (value) => {
            client = value
            return shared.setup(value)
        },
        dispose: () => {
            shared.dispose()
            client = undefined
        },
    }
}
