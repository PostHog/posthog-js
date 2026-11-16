import type { KeyValueStore } from '@posthog/browser-common'
import { RegisteredProperties } from './analytics-properties'

/** Property scope is labelled by core's SDK session, never by an independent clock. */
export class SessionRegisteredProperties {
    private readonly _properties: RegisteredProperties

    constructor(private readonly _kv: KeyValueStore) {
        this._properties = new RegisteredProperties(_kv)
    }

    values(sessionId: string | undefined): Record<string, unknown> {
        const scope = this._kv.get('sessionId')
        return scope === undefined || scope === sessionId ? this._properties.values() : {}
    }

    register(properties: Record<string, unknown>, sessionId: string | undefined): void {
        this._kv.set({ superProperties: { ...this.values(sessionId), ...properties }, sessionId })
    }

    unregister(property: string, sessionId: string | undefined): void {
        const values = this.values(sessionId)
        if (!Object.prototype.hasOwnProperty.call(values, property)) return
        delete values[property]
        this._kv.set({ superProperties: values, sessionId })
    }

    admitted(sessionId: string): void {
        const scope = this._kv.get('sessionId')
        if (scope === sessionId) return
        const properties = this._properties.values()
        if (scope === undefined && Object.keys(properties).length === 0) return
        this._kv.set({ superProperties: this.values(sessionId), sessionId })
    }

    clear(): void {
        this._kv.remove(['superProperties', 'sessionId'])
    }
}
