import type { CaptureOptions, CapturedEventInfo, Disposable, Listener } from '@posthog/browser-common'
import type { BrowserExtension } from './browser-client'
import type { CaptureSummary } from './types'

/** Application-facing analytics operations on one installed product instance. */
export interface IAnalytics extends BrowserExtension {
    readonly isRateLimited: boolean
    readonly onEvent: Listener<CapturedEventInfo>
    /**
     * Synchronous capture. False signals rate-limit backpressure; true does not acknowledge admission or delivery.
     * Consent, filtering, invalid properties and queue limits can suppress an event while returning true.
     */
    capture(event: string, properties?: Record<string, unknown> | null, options?: CaptureOptions): boolean
    captureImmediate(
        event: string,
        properties?: Record<string, unknown> | null,
        options?: CaptureOptions
    ): Promise<CaptureSummary>
    identify(distinctId: string, set?: Record<string, unknown>, setOnce?: Record<string, unknown>): Promise<void>
    alias(alias: string): void
    group(type: string, key: string, properties?: Record<string, unknown>): Promise<void>
    groupIdentify(
        type: string,
        key: string | number,
        properties?: Record<string, unknown>,
        options?: CaptureOptions
    ): void
    resetGroups(): void
    reset(): void
    createPersonProfile(): void
    setPersonProperties(set?: Record<string, unknown>, setOnce?: Record<string, unknown>): void
    unsetPersonProperties(names: string | readonly string[]): void
    setInternalOrTestUser(): void
    registerDynamicEventProperties(producer: () => Record<string, unknown>): Disposable
    flush(): Promise<void>
}
