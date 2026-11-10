import type { CaptureOptions, CapturedEventInfo, Disposable, Listener } from '@posthog/browser-common'
import type { BrowserExtension } from './browser-client'
import type { CaptureSummary } from './types'

/** Application-facing analytics operations on one installed product instance. */
export interface IAnalytics extends BrowserExtension {
    readonly isRateLimited: boolean
    readonly onEvent: Listener<CapturedEventInfo>
    capture(event: string, properties?: Record<string, unknown> | null, options?: CaptureOptions): boolean
    captureImmediate(
        event: string,
        properties?: Record<string, unknown> | null,
        options?: CaptureOptions
    ): Promise<CaptureSummary>
    identify(distinctId: string, set?: Record<string, unknown>, setOnce?: Record<string, unknown>): Promise<void>
    group(type: string, key: string, properties?: Record<string, unknown>): Promise<void>
    reset(): void
    registerDynamicEventProperties(producer: () => Record<string, unknown>): Disposable
    flush(): Promise<void>
}
