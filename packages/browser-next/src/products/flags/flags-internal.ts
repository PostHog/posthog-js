import type { FlagsOptions } from './flags-options'
import type { FeatureFlags } from './flags-token'

/** SDK-specific flags configuration read by surveys. Person properties are read from the shared client store. */
export interface FlagsExtension extends FeatureFlags {
    getSurveyContext(): { remoteEvaluation: boolean }
    /** Serves the flags and payloads that `reset({ bootstrap })` supplies for the new identity. */
    bootstrap(bootstrap: NonNullable<FlagsOptions['bootstrap']>): void
}
