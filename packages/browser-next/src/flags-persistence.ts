import type { Client, Disposable, KeyValueStore } from '@posthog/browser-common'
import {
    ENABLED_FEATURE_FLAGS,
    PERSISTENCE_ACTIVE_FEATURE_FLAGS,
    PERSISTENCE_FEATURE_FLAG_DETAILS,
    PERSISTENCE_FEATURE_FLAG_PAYLOADS,
    PERSISTENCE_FEATURE_FLAG_REQUEST_ID,
    PERSISTENCE_FEATURE_FLAG_EVALUATED_AT,
    PERSISTENCE_MINIMAL_FLAG_CALLED_EVENTS,
    STORED_PERSON_PROPERTIES_KEY,
} from '@posthog/browser-common/constants'
import type { FlagsHost } from './flags-internal'

const evaluationKeys = [
    ENABLED_FEATURE_FLAGS,
    PERSISTENCE_ACTIVE_FEATURE_FLAGS,
    PERSISTENCE_FEATURE_FLAG_DETAILS,
    PERSISTENCE_FEATURE_FLAG_PAYLOADS,
    PERSISTENCE_FEATURE_FLAG_REQUEST_ID,
    PERSISTENCE_FEATURE_FLAG_EVALUATED_AT,
    PERSISTENCE_MINIMAL_FLAG_CALLED_EVENTS,
    STORED_PERSON_PROPERTIES_KEY,
] as const

type Values = Record<string, unknown>
const copy = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T))
const object = (value: unknown): Values =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Values) : {}

/** Separate product record: unrelated core/session writes never replace flag snapshots. */
export class FlagsPersistence {
    private _values: Values = {}
    private _owned: Record<string, readonly string[] | true> = {}
    private readonly _handlers = new Set<() => void>()
    private _subscription: Disposable | undefined
    private _disposed = false
    private _writing = false
    private _storageFailed = false
    private _identity: string

    constructor(
        private readonly _host: FlagsHost,
        private readonly _client: Client
    ) {
        this._identity = _client.distinctId
        this._refresh()
        const refresh = () => {
            if (!this._writing && !this._disposed) this._refresh()
        }
        try {
            if (_host.observeNativeStorage) {
                const listener = (event: StorageEvent) => {
                    if (event.storageArea === _host.storage && (event.key === null || event.key === _host.key))
                        refresh()
                }
                // Native storage observation is scoped to this extension's lifetime.
                // oxlint-disable-next-line posthog-js/no-add-event-listener
                globalThis.addEventListener('storage', listener)
                this._subscription = { dispose: () => globalThis.removeEventListener('storage', listener) }
            } else {
                this._subscription = _host.storage?.subscribe?.(_host.key, refresh)
            }
        } catch {
            /* Memory state remains usable when observation is unavailable. */
        }
    }

    private _read(): { distinctId: string; values: Values } | undefined {
        if (this._storageFailed) return undefined
        try {
            const raw = this._host.storage?.getItem(this._host.key)
            if (!raw) return undefined
            const entry = JSON.parse(raw) as { distinctId?: unknown; values?: unknown }
            if (
                typeof entry.distinctId === 'string' &&
                entry.values &&
                typeof entry.values === 'object' &&
                !Array.isArray(entry.values)
            ) {
                return { distinctId: entry.distinctId, values: entry.values as Values }
            }
        } catch {
            this._storageFailed = true
        }
        return undefined
    }

    private _refresh(): void {
        const entry = this._read()
        if (
            !entry ||
            entry.distinctId !== this._identity ||
            JSON.stringify(entry.values) === JSON.stringify(this._values)
        )
            return
        const evaluationChanged = evaluationKeys.some(
            (key) => JSON.stringify(entry.values[key]) !== JSON.stringify(this._values[key])
        )
        this._values = entry.values
        if (evaluationChanged) for (const handler of this._handlers) handler()
    }

    readonly kv: KeyValueStore = {
        initialize: () => {},
        get: ((keys: string | readonly string[]) => {
            if (this._disposed) return undefined
            this._refresh()
            if (typeof keys === 'string') return copy(this._values[keys])
            const values: Values = {}
            for (const key of keys) if (this._values[key] !== undefined) values[key] = copy(this._values[key])
            return values
        }) as KeyValueStore['get'],
        set: ((key: string | Values, value?: unknown) =>
            this._set(typeof key === 'string' ? { [key]: value } : key)) as KeyValueStore['set'],
        remove: (keys) =>
            this._set(Object.fromEntries((typeof keys === 'string' ? [keys] : keys).map((key) => [key, undefined]))),
    }

    private _set(patch: Values): void {
        if (this._disposed) return
        const owned = this._owned
        this._owned = {}
        const entry = this._read()
        const mismatch = entry && entry.distinctId !== this._identity
        const next = copy(!mismatch && entry ? entry.values : this._values)
        for (const [key, value] of Object.entries(patch)) {
            let ownership = owned[key]
            if (!ownership && value && typeof value === 'object' && !Array.isArray(value)) {
                const previous = object(this._values[key])
                const updated = object(value)
                ownership = [...new Set([...Object.keys(previous), ...Object.keys(updated)])].filter(
                    (property) => JSON.stringify(previous[property]) !== JSON.stringify(updated[property])
                )
            }
            if (ownership && ownership !== true && value !== undefined) {
                if (key === PERSISTENCE_ACTIVE_FEATURE_FLAGS) {
                    const merged = new Set(Array.isArray(next[key]) ? (next[key] as string[]) : [])
                    const local = new Set(Array.isArray(value) ? (value as string[]) : [])
                    for (const property of ownership)
                        local.has(property) ? merged.add(property) : merged.delete(property)
                    next[key] = [...merged]
                } else {
                    const merged = { ...object(next[key]) }
                    const local = object(value)
                    for (const property of ownership) {
                        if (property in local) merged[property] = copy(local[property])
                        else delete merged[property]
                    }
                    next[key] = merged
                }
            } else if (value === undefined) delete next[key]
            else next[key] = copy(value)
        }
        this._values = next
        if (mismatch) return
        this._save()
    }

    private _save(): void {
        if (this._storageFailed) return
        this._writing = true
        try {
            this._host.storage?.setItem(
                this._host.key,
                JSON.stringify({ distinctId: this._identity, values: this._values })
            )
        } catch {
            this._storageFailed = true
        } finally {
            this._writing = false
        }
    }

    reidentify(clear = false): void {
        this._identity = this._client.distinctId
        if (clear) this._values = {}
        this._owned = {}
        this._save()
    }

    markCrossTabFeatureFlagChanges(changes: Record<string, readonly string[] | true>): void {
        Object.assign(this._owned, changes)
    }

    onCrossTabFeatureFlagChange(handler: () => void): () => void {
        this._handlers.add(handler)
        return () => {
            this._handlers.delete(handler)
        }
    }

    dispose(): void {
        if (this._disposed) return
        this._disposed = true
        this._handlers.clear()
        try {
            this._subscription?.dispose()
        } catch {
            /* Cleanup is best-effort. */
        }
    }
}
