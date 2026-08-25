import { createLogger } from '@posthog/browser-common/utils/logger'
import { isArray, isUndefined } from '@posthog/core'
import type { JsonType, PostHogConfig } from './types'

const logger = createLogger('[FeatureFlags]')
const DEFAULT_REFRESH_INTERVAL_MS = 5 * 60 * 1000

export interface FeatureFlagsConfig {
    readonly bootstrap: {
        readonly featureFlags?: Readonly<Record<string, string | boolean>>
        readonly featureFlagPayloads?: Readonly<Record<string, JsonType>>
    }
    readonly remoteRequestsDisabled: boolean
    readonly featureFlagsDisabled: boolean
    readonly onlyEvaluateSurveyFeatureFlags: boolean
    readonly deduplicateCallsPerSession: boolean
    readonly cacheTtlMs?: number
    readonly refreshIntervalMs?: number
    readonly requestTimeoutMs: number
    readonly compression: 'base64' | 'none'
    readonly evaluationContexts: readonly string[]
    readonly flagKeys?: readonly string[]
}

export interface FeatureFlagsConfigSource {
    get(): Readonly<FeatureFlagsConfig>
}

const snapshot = (config: PostHogConfig, remoteRequestsDisabled: boolean): FeatureFlagsConfig => ({
    bootstrap: {
        featureFlags: config.bootstrap?.featureFlags,
        featureFlagPayloads: config.bootstrap?.featureFlagPayloads,
    },
    remoteRequestsDisabled,
    featureFlagsDisabled: !!config.advanced_disable_feature_flags,
    onlyEvaluateSurveyFeatureFlags: !!config.advanced_only_evaluate_survey_feature_flags,
    deduplicateCallsPerSession: !!config.advanced_feature_flags_dedup_per_session,
    cacheTtlMs: config.feature_flag_cache_ttl_ms,
    refreshIntervalMs: config.remote_config_refresh_interval_ms ?? DEFAULT_REFRESH_INTERVAL_MS,
    requestTimeoutMs: config.feature_flag_request_timeout_ms,
    compression: config.disable_compression ? 'none' : 'base64',
    evaluationContexts: config.evaluation_contexts ?? config.evaluation_environments ?? [],
    flagKeys: isArray(config.flag_keys) ? config.flag_keys : undefined,
})

/** Mutable browser-v1 mapping kept outside the extension-facing config source. */
export class MutableFeatureFlagsConfigSource implements FeatureFlagsConfigSource {
    private _snapshot!: FeatureFlagsConfig
    private _loggedEvaluationEnvironmentsDeprecation = false

    constructor(config: PostHogConfig, remoteRequestsDisabled = false) {
        this.update(config, remoteRequestsDisabled)
    }

    update(config: PostHogConfig, remoteRequestsDisabled: boolean): void {
        this._snapshot = snapshot(config, remoteRequestsDisabled)
        if (
            config.evaluation_environments &&
            !config.evaluation_contexts &&
            !this._loggedEvaluationEnvironmentsDeprecation
        ) {
            logger.warn(
                'evaluation_environments is deprecated. Use evaluation_contexts instead. evaluation_environments will be removed in a future version.'
            )
            this._loggedEvaluationEnvironmentsDeprecation = true
        }
        if (!isUndefined(config.flag_keys) && !isArray(config.flag_keys)) {
            logger.error('Invalid flag_keys found:', config.flag_keys, 'Expected array of non-empty strings')
        }
    }

    get(): Readonly<FeatureFlagsConfig> {
        return this._snapshot
    }
}
