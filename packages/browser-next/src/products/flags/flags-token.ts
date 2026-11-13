import type { Disposable, ExtensionToken } from '@posthog/browser-common'
import type { FeatureFlagResult, FeatureFlagsReloadResult, FeatureFlagsCallback, JsonType } from './flags-options'
import type { IPostHogInternal, BrowserExtension } from '../../core/context/browser-client'

export interface IFeatureFlags extends BrowserExtension {
    setup(client: IPostHogInternal): void | Promise<void>
    getFeatureFlag(key: string): FeatureFlagResult | undefined
    /** Refresh remotely and await its outcome. Calls during an active evaluation wait for a follow-up request. */
    reloadFeatureFlags(): Promise<FeatureFlagsReloadResult>
    onFeatureFlags(callback: FeatureFlagsCallback): Disposable
    updateFlags(
        flags: Record<string, boolean | string>,
        payloads?: Record<string, JsonType>,
        options?: { merge?: boolean }
    ): void
}

/** Resolve installed feature flags without importing their implementation. */
export const FeatureFlagsExtension = 'featureFlags' as ExtensionToken<IFeatureFlags>
