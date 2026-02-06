export type GetProperty = (key: string) => string | null
export type SetProperty = (key: string, value: string) => void

export class PersistenceHelper {
    private readonly _getProperty: GetProperty
    private readonly _setProperty: SetProperty
    private readonly _prefix: string

    private _matchedInSession: boolean = false

    constructor(getProperty: GetProperty, setProperty: SetProperty, prefix: string = '') {
        this._getProperty = getProperty
        this._setProperty = setProperty
        this._prefix = prefix
    }

    /**
     * Creates a new PersistenceHelper with an extended prefix.
     * Chainable: helper.withPrefix('error_tracking').withPrefix('url')
     */
    withPrefix(prefix: string): PersistenceHelper {
        const newPrefix = this._prefix ? `${this._prefix}_${prefix}` : prefix
        return new PersistenceHelper(this._getProperty, this._setProperty, newPrefix)
    }

    /**
     * Check if the trigger was matched for this session.
     * Checks in-memory state first, then falls back to persistence.
     */
    sessionMatchesTrigger(sessionId: string): boolean {
        if (this._matchedInSession) {
            return true
        }
        const key = this._buildKey()
        return this._getProperty(key) === sessionId
    }

    /**
     * Mark the trigger as matched for the given session.
     * Sets both in-memory state and persists. Idempotent - does nothing if already matched.
     */
    matchTriggerInSession(sessionId: string): void {
        if (this._matchedInSession) {
            return
        }
        this._matchedInSession = true
        const key = this._buildKey()
        this._setProperty(key, sessionId)
    }

    private _buildKey(): string {
        return `$${this._prefix}_session`
    }
}
