import type { FeatureFlagResult, JsonType } from '@posthog/types'

export interface FlagsOptions {
    /** Evaluate flags remotely. Defaults to true; false retains bootstrap and injected values. */
    featureFlagEvaluation?: boolean
    bootstrap?: {
        featureFlags?: Readonly<Record<string, boolean | string>>
        featureFlagPayloads?: Readonly<Record<string, JsonType>>
    }
    evaluationContexts?: readonly string[]
    flagKeys?: readonly string[]
    /** Request timeout in milliseconds. Defaults to 3000. */
    requestTimeoutMs?: number
    cacheTtlMs?: number
    /** Refresh interval in milliseconds. Defaults to five minutes with idle backoff; 0 disables it. */
    refreshIntervalMs?: number
    deduplicateCallsPerSession?: boolean
    onlyEvaluateSurveyFeatureFlags?: boolean
}

export type FlagsConfiguration = false | FlagsOptions
export type FlagsCallback = (flags: FeatureFlagResult[], errorsLoading: boolean) => void
export type { FeatureFlagResult, JsonType }
export type { FeatureFlagsReloadResult } from '@posthog/browser-common/feature-flags'
