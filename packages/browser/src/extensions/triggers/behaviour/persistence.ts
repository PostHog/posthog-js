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

    isTriggered(sessionId: string): boolean {
        // Check in-memory cache first
        if (this._triggeredSessionId === sessionId) {
            return true
        }

        // Check persistence
        const key = this._buildKey()
        const persistedSessionId = this._getProperty(key)
        if (persistedSessionId === sessionId) {
            this._triggeredSessionId = sessionId
            return true
        }

        return false
    }

    setTriggered(sessionId: string): void {
        if (this._triggeredSessionId === sessionId) {
            return // Already triggered, idempotent
        }
        this._triggeredSessionId = sessionId
        const key = this._buildKey()
        this._setProperty(key, sessionId)
    }

    private _buildKey(): string {
        return `$${this._prefix}_triggered`
    }
}
