import type { KeyValueStore } from '@posthog/browser-common'
import { isUndefined } from '@posthog/core'
import type { PostHog } from '../posthog-core'
import type { Properties } from '../types'

export class BrowserClientKeyValueStore implements KeyValueStore {
    constructor(private readonly _instance: PostHog) {}

    initialize(): void {}

    get<T = unknown>(key: string): T | undefined
    get<T extends object>(keys: readonly (keyof T & string)[]): Partial<T>
    get(keyOrKeys: string | readonly string[]): unknown {
        const persistence = this._instance.persistence
        if (typeof keyOrKeys === 'string') {
            return persistence?.get_property(keyOrKeys)
        }
        const values: Record<string, unknown> = {}
        for (const key of keyOrKeys) {
            const value = persistence?.get_property(key)
            if (!isUndefined(value)) {
                values[key] = value
            }
        }
        return values
    }

    set(key: string, value: unknown): void
    set(values: Record<string, unknown>): void
    set(properties: string | Record<string, unknown>, value?: unknown): void {
        this._instance.persistence?.register(
            (typeof properties === 'string' ? { [properties]: value } : properties) as Properties
        )
    }

    remove(keyOrKeys: string | readonly string[]): void {
        this._instance.persistence?.unregister(keyOrKeys)
    }
}
