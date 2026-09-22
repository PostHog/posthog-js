import type { KeyValueStore } from '@posthog/browser-common'
import type { ReplayTriggerClient } from '@posthog/browser-common/replay/host'
import { createDisposable } from '@posthog/browser-common'
import { getTargetingUrl } from '@posthog/browser-common/utils/url-targeting-utils'
import type { PostHog } from '../../../posthog-core'

/** Maps existing behavioral fixtures to the shared trigger inputs. */
export function replayTriggerClient(instance: PostHog): ReplayTriggerClient {
    function get<T = unknown>(key: string): T | undefined
    function get<T extends object>(keys: readonly (keyof T & string)[]): Partial<T>
    function get(key: string | readonly string[]): unknown {
        if (typeof key === 'string') return instance.get_property?.(key)
        return Object.fromEntries(key.map((name) => [name, instance.get_property?.(name)]))
    }
    const kv: KeyValueStore = {
        initialize() {},
        get,
        set(key: string | Record<string, unknown>, value?: unknown) {
            instance.register(typeof key === 'string' ? { [key]: value } : key)
        },
        remove(key) {
            for (const name of typeof key === 'string' ? [key] : key) instance.unregister(name)
        },
    }
    return {
        kv,
        replay: {
            get targetingUrl() {
                return getTargetingUrl(instance)
            },
            registerSessionProperties: (properties) => instance.register_for_session(properties),
            onFlags: (callback) => createDisposable(instance.onFeatureFlags((_flags, variants) => callback(variants))),
        },
    }
}
