import type { CaptureSummary } from '@posthog/browser'
import type { CaptureSummary as CoreCaptureSummary } from '@posthog/browser/core'

export const captureError = (summary: CaptureSummary): Error | undefined => summary.error
export const coreCaptureError = (summary: CoreCaptureSummary): Error | undefined => summary.error
