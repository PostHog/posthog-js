import type { CaptureSummary } from './types'

export const EMPTY_CAPTURE_SUMMARY: CaptureSummary = Object.freeze({
    submitted: 0,
    notPersisted: 0,
    allPersisted: true,
    results: Object.freeze({}),
})

export const captureFailure = (cause: unknown, summary: CaptureSummary = EMPTY_CAPTURE_SUMMARY): CaptureSummary => {
    const error = new Error('Immediate capture failed', { cause })
    error.name = 'PostHogCaptureError'
    try {
        if (cause instanceof Error) {
            error.message = String(cause.message)
        }
    } catch {
        // Error inspection must not prevent returning the failure summary.
    }
    return Object.freeze({ ...summary, allPersisted: false, error })
}
