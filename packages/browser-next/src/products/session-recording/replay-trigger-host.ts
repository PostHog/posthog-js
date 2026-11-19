import type { Disposable } from '@posthog/browser-common'
import {
    SDK_DEBUG_REPLAY_MATCHED_RECORDING_TRIGGER_GROUPS,
    SDK_DEBUG_REPLAY_REMOTE_TRIGGER_MATCHING_CONFIG,
    SDK_DEBUG_REPLAY_TRIGGER_GROUPS_COUNT,
} from '@posthog/browser-common/replay/replay-constants'
import type { ReplayTriggerHost } from '@posthog/browser-common/replay/trigger-matching'
import { FeatureFlagsExtension } from '../flags/flags-token'
import type { IPostHog } from '../../core/types'

// optional replay diagnostics, which only some SDK events carry
const OPTIONAL_DEBUG_PROPERTIES = [
    SDK_DEBUG_REPLAY_MATCHED_RECORDING_TRIGGER_GROUPS,
    SDK_DEBUG_REPLAY_REMOTE_TRIGGER_MATCHING_CONFIG,
    SDK_DEBUG_REPLAY_TRIGGER_GROUPS_COUNT,
]

export interface ReplayDebugHost extends ReplayTriggerHost {
    /** The optional debug properties the trigger matching reported for the current session. */
    optionalDebugProperties(): Record<string, unknown>
}

/**
 * Adapts the client to the shared trigger matching: persisted replay decisions live in the client's
 * key-value store, required debug properties are registered for the session, optional ones are kept for
 * the recorder to report, and the linked flag reads the feature flags product when it is installed.
 */
export const createReplayTriggerHost = (client: IPostHog): ReplayDebugHost => {
    // status reads report trigger states on every replay event, so persist only the changes
    let registered: { sessionId: string | undefined; values: Record<string, unknown> } = {
        sessionId: undefined,
        values: {},
    }
    const registerForSession = (properties: Record<string, unknown>): void => {
        const sessionId = client.session?.sessionId
        if (registered.sessionId !== sessionId) registered = { sessionId, values: {} }
        const changed = Object.entries(properties).filter(([key, value]) => registered.values[key] !== value)
        if (!changed.length) return
        for (const [key, value] of changed) registered.values[key] = value
        const required = changed.filter(([key]) => !OPTIONAL_DEBUG_PROPERTIES.includes(key))
        if (required.length) client.registerForSession(Object.fromEntries(required))
    }
    const onFeatureFlags: ReplayTriggerHost['onFeatureFlags'] = (callback) => {
        let active = true
        let subscription: Disposable | undefined
        void client
            .resolveExtension(FeatureFlagsExtension)
            .then((flags) => {
                if (!active || !flags) return
                subscription = flags.onFeatureFlags((results) => {
                    const variants: Record<string, string | boolean> = {}
                    for (const result of results) {
                        variants[result.key] = result.variant ?? result.enabled
                    }
                    callback(Object.keys(variants), variants)
                })
            })
            .catch((error: unknown) => client.logger.error('Session recording could not read feature flags', error))
        return () => {
            active = false
            subscription?.dispose()
        }
    }
    return {
        config: {},
        get_property: (key) => client.kv.get(key),
        register_for_session: registerForSession,
        persistence: {
            register: (properties) => client.kv.set(properties),
            unregister: (key) => client.kv.remove(key),
        },
        onFeatureFlags,
        optionalDebugProperties: () =>
            registered.sessionId === client.session?.sessionId
                ? Object.fromEntries(
                      Object.entries(registered.values).filter(([key]) => OPTIONAL_DEBUG_PROPERTIES.includes(key))
                  )
                : {},
    }
}
