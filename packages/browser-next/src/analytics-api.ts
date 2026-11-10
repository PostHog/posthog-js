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
    register(properties: Record<string, unknown>): void
    registerOnce(properties: Record<string, unknown>, defaultValue?: unknown): void
    registerForSession(properties: Record<string, unknown>): void
    unregisterForSession(property: string): void
    getSessionProperty(property: string): unknown
    unregister(property: string): void
    getProperty(property: string): unknown
    registerDynamicEventProperties(producer: () => Record<string, unknown>): Disposable
    flush(): Promise<void>
}
