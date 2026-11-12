import type { Disposable, ExtensionToken } from '@posthog/browser-common'
import type { FeatureFlagResult, FeatureFlagsReloadResult, FeatureFlagsCallback, JsonType } from './flags-options'
import type { IPostHogInternal, BrowserExtension } from '../../core/context/browser-client'

export interface IFeatureFlags extends BrowserExtension {
    setup(client: IPostHogInternal): void | Promise<void>
    getFeatureFlag(key: string): FeatureFlagResult | undefined
    /** Refresh remotely and await its outcome. Calls during an active evaluation wait for a follow-up request. */
    reloadFeatureFlags(): Promise<FeatureFlagsReloadResult>
    onFeatureFlags(callback: FeatureFlagsCallback): Disposable
    /** Merge local person-property overrides for evaluation. Reloads by default; does not update a person profile. */
    setPersonPropertiesForFlags(properties: Record<string, unknown>, reloadFeatureFlags?: boolean): void
    /** Clear all local person-property overrides. Reloads by default. */
    resetPersonPropertiesForFlags(reloadFeatureFlags?: boolean): void
    /** Merge local evaluation properties per group type. Reloads by default; does not associate groups or update profiles. */
    setGroupPropertiesForFlags(
        propertiesByGroupType: Record<string, Record<string, unknown>>,
        reloadFeatureFlags?: boolean
    ): void
    /** Clear one group's local evaluation properties, or all groups when omitted. Does not reload flags. */
    resetGroupPropertiesForFlags(groupType?: string): void
    updateFlags(
        flags: Record<string, boolean | string>,
        payloads?: Record<string, JsonType>,
        options?: { merge?: boolean }
    ): void
}

/** Resolve installed feature flags without importing their implementation. */
export const FeatureFlagsExtension = 'featureFlags' as ExtensionToken<IFeatureFlags>
