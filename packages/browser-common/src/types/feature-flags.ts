import type { FeatureFlagDetail, JsonType } from '@posthog/types'
import type { RemoteConfig } from './remote-config'

/**
 * Flags returns feature flags and their payloads
 */
export interface FlagsResponse extends RemoteConfig {
    featureFlags: Record<string, string | boolean>
    featureFlagPayloads: Record<string, JsonType>
    errorsWhileComputingFlags: boolean
    requestId?: string
    flags: Record<string, FeatureFlagDetail>
    evaluatedAt?: number
    /**
     * Server-controlled gate for minimal `$feature_flag_called` events. `true` only when the
     * project opted in; omitted otherwise. Absence always means full events.
     */
    minimalFlagCalledEvents?: boolean
}
