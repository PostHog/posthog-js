/**
 * Feature flag types
 */

import type { JsonType } from './common'

export type FeatureFlagsCallback = (
    flags: string[],
    variants: Record<string, string | boolean>,
    context?: {
        errorsLoading?: boolean
    }
) => void

export type FeatureFlagDetail = {
    key: string
    enabled: boolean
    // Only used when overriding a flag payload.
    original_enabled?: boolean | undefined
    variant: string | undefined
    // Only used when overriding a flag payload.
    original_variant?: string | undefined
    reason: EvaluationReason | undefined
    metadata: FeatureFlagMetadata | undefined
}

export type FeatureFlagMetadata = {
    id: number
    version: number | undefined
    description: string | undefined
    payload: JsonType | undefined
    // Only used when overriding a flag payload.
    original_payload?: JsonType | undefined
}

export type EvaluationReason = {
    code: string
    condition_index: number | undefined
    description: string | undefined
}

export type RemoteConfigFeatureFlagCallback = (payload: JsonType) => void

// Sync this with the backend's EarlyAccessFeatureSerializer!
/** A feature that isn't publicly available yet.*/
export interface EarlyAccessFeature {
    name: string
    description: string
    stage: 'concept' | 'alpha' | 'beta'
    documentationUrl: string | null
    payload: JsonType
    flagKey: string | null
}

export type EarlyAccessFeatureStage = 'concept' | 'alpha' | 'beta' | 'general-availability'
export type EarlyAccessFeatureCallback = (earlyAccessFeatures: EarlyAccessFeature[]) => void

/**
 * Result of evaluating a feature flag, including both the flag value and its payload.
 */
export type FeatureFlagResult = {
    /** The key of the feature flag */
    readonly key: string
    /** Whether the feature flag is enabled (truthy value) */
    readonly enabled: boolean
    /** The variant key if this is a multivariate flag, undefined for boolean flags */
    readonly variant: string | undefined
    /** The JSON payload associated with this flag, if any */
    readonly payload: JsonType | undefined
}

export interface EarlyAccessFeatureResponse {
    earlyAccessFeatures: EarlyAccessFeature[]
}
