import type { IFeatureFlags } from './flags-token'

/** SDK-specific flags configuration and persisted survey targeting context. */
export interface IFeatureFlagsInternal extends IFeatureFlags {
    getSurveyContext(): {
        remoteEvaluation: boolean
        personProperties: Record<string, unknown> | undefined
    }
}
