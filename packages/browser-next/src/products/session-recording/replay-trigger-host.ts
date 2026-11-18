import type { Disposable } from '@posthog/browser-common'
import type { ReplayTriggerHost } from '@posthog/browser-common/replay/trigger-matching'
import { FeatureFlagsExtension } from '../flags/flags-token'
import type { IPostHog } from '../../core/types'

/**
 * Adapts the client to the shared trigger matching: persisted replay decisions live in the client's
 * key-value store, debug properties are registered for the session, and the linked flag reads the
 * feature flags product when it is installed.
 */
export const createReplayTriggerHost = (client: IPostHog): ReplayTriggerHost => {
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
        client.registerForSession(Object.fromEntries(changed))
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
    }
}
