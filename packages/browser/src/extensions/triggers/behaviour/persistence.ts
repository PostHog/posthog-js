export type GetProperty = (key: string) => unknown
export type SetProperty = (key: string, value: unknown) => void

export class PersistenceHelper {
    private readonly _getProperty: GetProperty
    private readonly _setProperty: SetProperty
    private readonly _prefix: string

    private _triggeredSessionId: string | null = null

    constructor(getProperty: GetProperty, setProperty: SetProperty, prefix: string = '') {
        this._getProperty = getProperty
        this._setProperty = setProperty
        this._prefix = prefix
    }

    withPrefix(prefix: string): PersistenceHelper {
        const newPrefix = this._prefix ? `${this._prefix}_${prefix}` : prefix
        return new PersistenceHelper(this._getProperty, this._setProperty, newPrefix)
    }

    // Generic get/set for custom storage 
    get<T>(keySuffix: string): T | null {
        const key = this._buildKey(keySuffix)
        return (this._getProperty(key) as T) ?? null
    }

    set<T>(keySuffix: string, value: T): void {
        const key = this._buildKey(keySuffix)
        this._setProperty(key, value)
    }

    // Convenience methods for simple "triggered" tracking
    isTriggered(sessionId: string): boolean {
        if (this._triggeredSessionId === sessionId) {
            return true
        }

        const persistedSessionId = this.get<string>('triggered')
        if (persistedSessionId === sessionId) {
            this._triggeredSessionId = sessionId
            return true
        }

        return false
    }

    setTriggered(sessionId: string): void {
        if (this._triggeredSessionId === sessionId) {
            return
        }
        this._triggeredSessionId = sessionId
        this.set('triggered', sessionId)
    }

    private _buildKey(suffix: string): string {
        return `$${this._prefix}_${suffix}`
    }
}
