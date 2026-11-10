import type { KeyValueStore } from '@posthog/browser-common'
import type { StorageLike } from './types'

export const cloneJson = <T>(value: T): T => {
    const json = JSON.stringify(value)
    if (json === undefined) throw new TypeError('The value must be JSON-serializable')
    return JSON.parse(json) as T
}

interface StoreContext {
    values(): Record<string, unknown>
    save(): void
    canAccess(): boolean
}

const createReader = (context: StoreContext): KeyValueStore['get'] => {
    const read = (key: string): unknown => {
        if (!context.canAccess()) return undefined
        const value = context.values()[key]
        return value === undefined ? undefined : cloneJson(value)
    }
    return (<T>(keyOrKeys: string | readonly string[]): T | Partial<T> | undefined => {
        if (typeof keyOrKeys === 'string') return read(keyOrKeys) as T | undefined
        const entries: Record<string, unknown> = Object.create(null)
        for (const key of keyOrKeys) {
            const value = read(key)
            if (value !== undefined) entries[key] = value
        }
        return entries as Partial<T>
    }) as KeyValueStore['get']
}

const createWriter = (context: StoreContext): KeyValueStore['set'] =>
    ((keyOrValues: string | Record<string, unknown>, value?: unknown): void => {
        if (!context.canAccess()) return
        const values = context.values()
        const entries = typeof keyOrValues === 'string' ? { [keyOrValues]: value } : keyOrValues
        for (const [key, entry] of Object.entries(entries)) {
            if (entry === undefined) delete values[key]
            else values[key] = cloneJson(entry)
        }
        context.save()
    }) as KeyValueStore['set']

const createRemover =
    (context: StoreContext): KeyValueStore['remove'] =>
    (keyOrKeys) => {
        if (!context.canAccess()) return
        const values = context.values()
        for (const key of typeof keyOrKeys === 'string' ? [keyOrKeys] : keyOrKeys) delete values[key]
        context.save()
    }

/** Own, bound methods preserve the shared KV contract, including copied views. */
export const createKeyValueStore = (context: StoreContext): KeyValueStore => ({
    initialize() {},
    get: createReader(context),
    set: createWriter(context),
    remove: createRemover(context),
})

/** Core-owned per-tab buffer; failed native access falls back to this buffer. */
export class TabValues {
    private _values: Record<string, unknown> | undefined
    private _backend: StorageLike | undefined

    constructor(
        private readonly _key: string,
        private readonly _storage: () => StorageLike | undefined
    ) {}

    values(): Record<string, unknown> {
        if (this._values) return this._values
        try {
            this._backend = this._storage()
            const raw = this._backend?.getItem(this._key)
            const parsed: unknown = raw ? JSON.parse(raw) : undefined
            const values: Record<string, unknown> = Object.create(null)
            Object.assign(values, typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {})
            // Native resolution/read callbacks may have completed a nested initialization.
            this._values ??= values
        } catch {
            this._backend = undefined
            this._values ??= Object.create(null) as Record<string, unknown>
        }
        return this._values
    }

    save(): void {
        try {
            this._backend?.setItem(this._key, JSON.stringify(this.values()))
        } catch {
            // The synchronous buffer remains usable when tab storage is unavailable.
        }
    }
}
