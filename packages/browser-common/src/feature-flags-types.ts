import type { Client } from './client'
import type { Extension } from './extension'
import type { FlagsResponse } from './types/feature-flags'
import type {
    FeatureFlagsCallback,
    EarlyAccessFeatureCallback,
    Properties,
    JsonType,
    EarlyAccessFeatureStage,
    FeatureFlagDetail,
    FeatureFlagResult,
    FeatureFlagOptions,
    IsFeatureEnabledOptions,
    OverrideFeatureFlagsOptions,
    RemoteConfigFeatureFlagCallback,
} from '@posthog/types'

export interface FeatureFlagsReloadResult {
    /** loaded: evaluation completed; error: request/evaluation failed; skipped: evaluation unavailable; cancelled: reset/disposal. */
    status: 'loaded' | 'error' | 'skipped' | 'cancelled'
}

/** Shared feature-flag capabilities exposed through the host's extension lookup. */
export interface IFeatureFlagsCommon extends Extension {
    readonly name: string
    _override_warning: boolean
    featureFlagEventHandlers: FeatureFlagsCallback[]
    $anon_distinct_id: string | undefined
    setup(client: Client): void | Promise<void>
    destroy(): void
    dispose(): void
    initialize(): void
    updateFlags(
        flags: Record<string, boolean | string>,
        payloads?: Record<string, JsonType>,
        options?: {
            merge?: boolean
        }
    ): void
    readonly hasLoadedFlags: boolean
    getFlags(): string[]
    getFlagsWithDetails(): Record<string, FeatureFlagDetail>
    getAllFeatureFlags(): FeatureFlagResult[]
    getFlagVariants(): Record<string, string | boolean>
    getFlagPayloads(): Record<string, JsonType>
    reloadFeatureFlags(): void
    reloadFeatureFlagsAsync(): Promise<FeatureFlagsReloadResult>
    onReloading(handler: () => void): () => void
    ensureFlagsLoaded(): void
    setAnonymousDistinctId(anon_distinct_id: string | undefined): void
    setReloadingPaused(isPaused: boolean): void
    resetFlagCallReported(): void
    sendFlagCallsPendingCapture(): void
    _callFlagsEndpoint(options?: { disableFlags?: boolean }): void
    getFeatureFlag(key: string, options?: FeatureFlagOptions): boolean | string | undefined
    getFeatureFlagDetails(key: string): FeatureFlagDetail | undefined
    getFeatureFlagPayload(key: string): JsonType
    getFeatureFlagResult(key: string, options?: FeatureFlagOptions): FeatureFlagResult | undefined
    getRemoteConfigPayload(key: string, callback: RemoteConfigFeatureFlagCallback): void
    isFeatureEnabled(
        key: string,
        options: IsFeatureEnabledOptions & {
            defaultValue: boolean
        }
    ): boolean
    isFeatureEnabled(key: string, options?: IsFeatureEnabledOptions): boolean | undefined
    addFeatureFlagsHandler(handler: FeatureFlagsCallback): void
    removeFeatureFlagsHandler(handler: FeatureFlagsCallback): void
    receivedFeatureFlags(
        response: Partial<FlagsResponse>,
        errorsLoading?: boolean,
        options?: {
            partialResponse?: boolean
        }
    ): void
    override(flags: boolean | string[] | Record<string, string | boolean>, suppressWarning?: boolean): void
    overrideFeatureFlags(overrideOptions: OverrideFeatureFlagsOptions): void
    onFeatureFlags(callback: FeatureFlagsCallback): () => void
    updateEarlyAccessFeatureEnrollment(key: string, isEnrolled: boolean, stage?: string): void
    getEarlyAccessFeatures(
        callback: EarlyAccessFeatureCallback,
        force_reload?: boolean,
        stages?: EarlyAccessFeatureStage[]
    ): void
    _prepareFeatureFlagsForCallbacks(): {
        flags: string[]
        flagVariants: Record<string, string | boolean>
    }
    _fireFeatureFlagsCallbacks(errorsLoading?: boolean): void
    setPersonPropertiesForFlags(properties: Properties, reloadFeatureFlags?: boolean): void
    unsetPersonPropertiesForFlags(propertyNames: string[], reloadFeatureFlags?: boolean): void
    resetPersonPropertiesForFlags(reloadFeatureFlags?: boolean): void
    setGroupPropertiesForFlags(
        properties: {
            [type: string]: Properties
        },
        reloadFeatureFlags?: boolean
    ): void
    resetGroupPropertiesForFlags(group_type?: string): void
    reset(): void
}
