import type { Disposable, ExtensionToken } from '@posthog/browser-common'
import type {
    EarlyAccessFeatureCallback,
    EarlyAccessFeatureStage,
    FeatureFlagResult,
    FeatureFlagsReloadResult,
    FlagsCallback,
    FlagsReadOptions,
    JsonType,
} from './flags-options'
import type { BrowserExtension } from '../../core/context/browser-client'
import type { IPostHog } from '../../core/types'

export interface FeatureFlags extends BrowserExtension {
    setup(client: IPostHog): void | Promise<void>
    getFeatureFlag(key: string, options?: FlagsReadOptions): FeatureFlagResult | undefined
    /** Read detached snapshots of all known results synchronously without emitting exposure events. */
    getAllFeatureFlags(): FeatureFlagResult[]
    /** Observe automatic and explicit reload starts, not their completion. */
    onReloading(callback: () => void): Disposable
    /** Refresh remotely and await its outcome. Calls during an active evaluation wait for a follow-up request. */
    reloadFeatureFlags(): Promise<FeatureFlagsReloadResult>
    onFeatureFlags(callback: FlagsCallback): Disposable
    /**
     * Merge local person-property overrides for evaluation. Reloads by default; an empty object does nothing.
     * Does not update a person profile.
     */
    setPersonPropertiesForFlags(properties: Record<string, unknown>, reloadFeatureFlags?: boolean): void
    /** Clear all local person-property overrides. Reloads by default. */
    resetPersonPropertiesForFlags(reloadFeatureFlags?: boolean): void
    /**
     * Merge local evaluation properties per group type. Reloads by default; an empty object does nothing.
     * Does not associate groups or update profiles.
     */
    setGroupPropertiesForFlags(
        propertiesByGroupType: Record<string, Record<string, unknown>>,
        reloadFeatureFlags?: boolean
    ): void
    /** Clear one group's local evaluation properties, or all groups when omitted. Does not reload flags. */
    resetGroupPropertiesForFlags(groupType?: string): void
    /**
     * List cached early-access features, or fetch them with optional stage query filters. As in posthog-js, any
     * response with a JSON body replaces the cached list and reaches the callback, even when the request failed, so
     * the callback can receive `undefined`.
     */
    getEarlyAccessFeatures(
        callback: EarlyAccessFeatureCallback,
        forceReload?: boolean,
        stages?: EarlyAccessFeatureStage[]
    ): void
    /** Update local enrollment and capture the enrollment change through ordinary consent gating. */
    updateEarlyAccessFeatureEnrollment(key: string, isEnrolled: boolean, stage?: string): void
    updateFlags(
        flags: Record<string, boolean | string>,
        payloads?: Record<string, JsonType>,
        options?: { merge?: boolean }
    ): void
}

/** Resolve installed feature flags without importing their implementation. */
export const FeatureFlagsExtension = 'featureFlags' as ExtensionToken<FeatureFlags>
