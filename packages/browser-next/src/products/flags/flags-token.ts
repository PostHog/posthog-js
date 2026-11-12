import type { Disposable, ExtensionToken } from '@posthog/browser-common'
import type {
    FeatureFlagResult,
    FeatureFlagsReloadResult,
    FeatureFlagsCallback,
    FeatureFlagsReadOptions,
    JsonType,
} from './flags-options'
import type { IPostHogInternal, BrowserExtension } from '../../core/context/browser-client'

export interface IFeatureFlags extends BrowserExtension {
    setup(client: IPostHogInternal): void | Promise<void>
    getFeatureFlag(key: string, options?: FeatureFlagsReadOptions): FeatureFlagResult | undefined
    /** Read detached snapshots of all known results synchronously without emitting exposure events. */
    getAllFeatureFlags(): FeatureFlagResult[]
    /** Observe automatic and explicit reload starts, not their completion. */
    onReloading(callback: () => void): Disposable
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
