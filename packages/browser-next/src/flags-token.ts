import type { Disposable, ExtensionToken } from '@posthog/browser-common'
import type { FeatureFlagResult, FeatureFlagsReloadResult, FlagsCallback, JsonType } from './flags-options'
import type { IPostHogInternal, BrowserExtension } from './browser-client'

export interface FeatureFlags extends BrowserExtension {
    setup(client: IPostHogInternal): void | Promise<void>
    getFeatureFlag(key: string): FeatureFlagResult | undefined
    /** Refresh remotely and await its outcome. Calls during an active evaluation wait for a follow-up request. */
    reloadFeatureFlags(): Promise<FeatureFlagsReloadResult>
    onFeatureFlags(callback: FlagsCallback): Disposable
    updateFlags(
        flags: Record<string, boolean | string>,
        payloads?: Record<string, JsonType>,
        options?: { merge?: boolean }
    ): void
}

/** Resolve installed feature flags without importing their implementation. */
export const FeatureFlagsExtension = 'featureFlags' as ExtensionToken<FeatureFlags>
