import type { PostHogFeatureFlags } from '@posthog/browser-common/feature-flags'
import type { FeatureFlags } from './flags-token'

/** Lookup view only; the facade owns setup and disposal. */
export interface FlagsExtension extends FeatureFlags {
    getSurveyContext(): {
        remoteEvaluation: boolean
        personProperties: Record<string, unknown> | undefined
    }
    readonly _shared: PostHogFeatureFlags
}
