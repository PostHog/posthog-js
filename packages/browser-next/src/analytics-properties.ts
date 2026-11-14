import type { KeyValueStore } from '@posthog/browser-common'

const REGISTERED_PROPERTIES = 'superProperties'
const isPropertyMap = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

export const snapshotRegisteredProperties = (value: Record<string, unknown>): Record<string, unknown> | undefined => {
    try {
        if (!isPropertyMap(value)) return undefined
        const snapshot: unknown = JSON.parse(JSON.stringify(value))
        return isPropertyMap(snapshot) ? snapshot : undefined
    } catch {
        return undefined
    }
}

/** Persistent event context in analytics' existing host-owned namespace. */
export class RegisteredProperties {
    constructor(private readonly _kv: KeyValueStore) {}

    values(): Record<string, unknown> {
        const value = this._kv.get(REGISTERED_PROPERTIES)
        return isPropertyMap(value) ? value : {}
    }

    get(property: string): unknown {
        const values = this.values()
        return Object.prototype.hasOwnProperty.call(values, property) ? values[property] : undefined
    }

    register(properties: Record<string, unknown>): void {
        this._kv.set(REGISTERED_PROPERTIES, { ...this.values(), ...properties })
    }

    registerOnce(properties: Record<string, unknown>, defaultValue: unknown): void {
        const values = this.values()
        const additions = Object.fromEntries(
            Object.entries(properties).filter(
                ([key]) => !Object.prototype.hasOwnProperty.call(values, key) || values[key] === defaultValue
            )
        )
        if (Object.keys(additions).length === 0) return
        this._kv.set(REGISTERED_PROPERTIES, { ...values, ...additions })
    }

    unregister(property: string): void {
        const values = this.values()
        if (!Object.prototype.hasOwnProperty.call(values, property)) return
        delete values[property]
        this._kv.set(REGISTERED_PROPERTIES, values)
    }
}
