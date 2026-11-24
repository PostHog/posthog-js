import type { FeatureFlags } from './flags-token'

/** SDK-specific flags configuration read by surveys. Person properties are read from the shared client store. */
export interface FlagsExtension extends FeatureFlags {
    getSurveyContext(): { remoteEvaluation: boolean }
}
