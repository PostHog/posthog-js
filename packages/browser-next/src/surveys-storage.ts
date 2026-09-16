import type { KeyValueStore } from '@posthog/browser-common'
import type { SurveyStorage } from '@posthog/browser-common/utils/survey-storage'
import type { SurveysHost } from './surveys-internal'

/** One product record keeps UI state and cached definitions out of core's whole-record writes. */
export class SurveysStorage implements SurveyStorage {
    private _values: Record<string, string> = Object.create(null)
    private _failed = false
    private _disposed = false

    constructor(private readonly _host: SurveysHost | undefined) {}

    private _read(): void {
        if (this._failed || !this._host?.storage) return
        try {
            const raw = this._host.storage.getItem(this._host.key)
            const value: unknown = raw ? JSON.parse(raw) : {}
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                this._values = Object.assign(Object.create(null), value)
            }
        } catch {
            this._failed = true
        }
    }

    getItem(key: string): string | null {
        this._read()
        const value = this._values[key]
        return typeof value === 'string' ? value : null
    }

    private _write(patch: Record<string, string | undefined>): void {
        if (this._disposed) return
        this._read()
        for (const [key, value] of Object.entries(patch)) {
            if (value === undefined) delete this._values[key]
            else this._values[key] = value
        }
        if (!this._failed) {
            try {
                this._host?.storage?.setItem(this._host.key, JSON.stringify(this._values))
            } catch {
                this._failed = true
            }
        }
    }

    setItem(key: string, value: string): void {
        this._write({ [key]: value })
    }
    removeItem(key: string): void {
        this._write({ [key]: undefined })
    }
    reset(): void {
        this._read()
        this._write(Object.fromEntries(Object.keys(this._values).map((key) => [key, undefined])))
    }
    dispose(): void {
        this._disposed = true
    }

    readonly kv: KeyValueStore = {
        initialize: () => this._read(),
        get: ((key: string | readonly string[]) => {
            const read = (name: string) => {
                const raw = this.getItem(name)
                try {
                    return raw === null ? undefined : JSON.parse(raw)
                } catch {
                    return undefined
                }
            }
            return typeof key === 'string' ? read(key) : Object.fromEntries(key.map((name) => [name, read(name)]))
        }) as KeyValueStore['get'],
        set: ((key: string | Record<string, unknown>, value?: unknown) => {
            const values = typeof key === 'string' ? { [key]: value } : key
            this._write(
                Object.fromEntries(Object.entries(values).map(([name, entry]) => [name, JSON.stringify(entry)]))
            )
        }) as KeyValueStore['set'],
        remove: (keys) =>
            this._write(Object.fromEntries((typeof keys === 'string' ? [keys] : keys).map((key) => [key, undefined]))),
    }
}
