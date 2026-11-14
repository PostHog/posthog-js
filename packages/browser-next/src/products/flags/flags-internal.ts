import type { FeatureFlags } from './flags-token'

/** SDK-specific flags configuration and persisted survey targeting context. */
export interface FlagsExtension extends FeatureFlags {
    getSurveyContext(): {
        remoteEvaluation: boolean
        personProperties: Record<string, unknown> | undefined
    }
}
