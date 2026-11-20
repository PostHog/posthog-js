export type WebVitalsMetric = 'LCP' | 'CLS' | 'FCP' | 'INP'

export interface WebVitalsOptions {
    /** Capture web vitals. A boolean overrides the project setting; when unset, the project setting applies. */
    enabled?: boolean
    /** Metrics to capture. Defaults to the project setting, or all four metrics when the project sets none. */
    allowedMetrics?: readonly WebVitalsMetric[]
    /**
     * Metrics that include attribution: `true` for all, `false` for none, or an array to name them.
     * Defaults to INP and LCP, because CLS attribution holds detached DOM nodes in single-page apps.
     */
    attribution?: boolean | readonly WebVitalsMetric[]
    /** Maximum time in milliseconds to buffer metrics before capturing them. Defaults to 5000. */
    delayedFlushMs?: number
    /**
     * Preview: scope metrics to the browser's Soft Navigation entries so single-page-app route changes start a
     * fresh measurement window. Relies on Chrome's experimental Soft Navigation Detection API. Defaults to false.
     */
    previewSoftNavigations?: boolean
}

export type WebVitalsConfiguration = false | WebVitalsOptions
