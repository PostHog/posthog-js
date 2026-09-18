import type { FeatureFlags } from './flags-token'

/** Package-private flag context for logs without exposure events. */
export interface FlagsExtension extends FeatureFlags {
    getActiveFlags(): string[]
}
