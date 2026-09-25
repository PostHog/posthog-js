import type { KeyValueStore } from '@posthog/browser-common'
import type { SurveyStorage } from '@posthog/browser-common/utils/survey-storage'

/** Adapt the renderer's string storage to the extension's host-provided KV namespace. */
export class SurveysStorage implements SurveyStorage {
    constructor(private readonly _kv: KeyValueStore) {}

    getItem(key: string): string | null {
        const value = this._kv.get(key)
        return typeof value === 'string' ? value : null
    }

    setItem(key: string, value: string): void {
        this._kv.set(key, value)
    }

    removeItem(key: string): void {
        this._kv.remove(key)
    }
}
