import type { Disposable, ExtensionToken } from '@posthog/browser-common'
import type {
    EarlyAccessFeatureCallback,
    EarlyAccessFeatureStage,
    FeatureFlagResult,
    FeatureFlagsReloadResult,
    FeatureFlagsCallback,
    JsonType,
} from './flags-options'
import type { IPostHogInternal, BrowserExtension } from '../../core/context/browser-client'

export interface IFeatureFlags extends BrowserExtension {
    setup(client: IPostHogInternal): void | Promise<void>
    getFeatureFlag(key: string): FeatureFlagResult | undefined
    /** Refresh remotely and await its outcome. Calls during an active evaluation wait for a follow-up request. */
    reloadFeatureFlags(): Promise<FeatureFlagsReloadResult>
    onFeatureFlags(callback: FeatureFlagsCallback): Disposable
    /** List cached early-access features, or fetch them with optional stage query filters. */
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
export const FeatureFlagsExtension = 'featureFlags' as ExtensionToken<IFeatureFlags>
