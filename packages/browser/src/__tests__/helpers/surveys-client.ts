import type { Client, KeyValueStore } from '@posthog/browser-common'
import { isString, isUndefined } from '@posthog/core'
import { BrowserClientAdapter } from '../../extensions/browser-client'
import type { PostHog } from '../../posthog-core'

// These tests control get_property directly, rather than the production persistence reader.
class SurveysTestKeyValueStore implements KeyValueStore {
    constructor(private readonly _posthog: PostHog) {}
    initialize(): void {}
    get<T = unknown>(key: string): T | undefined
    get<T extends object>(keys: readonly (keyof T & string)[]): Partial<T>
    get(keyOrKeys: string | readonly string[]): unknown {
        if (isString(keyOrKeys)) return this._posthog.get_property(keyOrKeys)
        const result: Record<string, unknown> = {}
        for (const key of keyOrKeys) {
            const value = this._posthog.get_property(key)
            if (!isUndefined(value)) result[key] = value
        }
        return result
    }
    set(key: string, value: unknown): void
    set(values: Record<string, unknown>): void
    set(keyOrValues: string | Record<string, unknown>, value?: unknown): void {
        this._posthog.persistence?.register(isString(keyOrValues) ? { [keyOrValues]: value } : keyOrValues)
    }
    remove(keyOrKeys: string | readonly string[]): void {
        this._posthog.persistence?.unregister(keyOrKeys)
    }
}

class SurveysTestClient extends BrowserClientAdapter {
    override readonly kv = new SurveysTestKeyValueStore(this.instance)
    // Remote outcomes in these tests are driven directly on BrowserSurveys.
    override readonly onRemoteConfig: Client['onRemoteConfig'] = () => ({ dispose: () => {} })
}

export const createSurveysClient = (posthog: PostHog): Client => new SurveysTestClient(posthog)
