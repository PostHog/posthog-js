import type { JsonType } from '@posthog/types'
import type { Compression } from './types/compression'

export interface FeatureFlagsConfig {
    readonly bootstrap: {
        readonly featureFlags?: Readonly<Record<string, string | boolean>>
        readonly featureFlagPayloads?: Readonly<Record<string, JsonType>>
    }
    /**
     * Store bootstrapped payloads JSON-encoded, like payloads from `/flags`, so reads return them as supplied.
     * Events still report the bootstrapped payload as supplied.
     */
    readonly encodeBootstrapPayloads?: boolean
    readonly remoteRequestsDisabled: boolean
    readonly featureFlagsDisabled: boolean
    readonly onlyEvaluateSurveyFeatureFlags: boolean
    readonly deduplicateCallsPerSession: boolean
    readonly cacheTtlMs?: number
    readonly refreshIntervalMs?: number
    readonly idleRefreshBackoff: boolean
    readonly requestTimeoutMs: number
    readonly requestMaxRetries?: number
    readonly compression?: Compression | 'best-available'
    readonly evaluationContexts: readonly string[]
    readonly flagKeys?: readonly string[]
}

export interface FeatureFlagsConfigSource {
    get(): Readonly<FeatureFlagsConfig>
}
