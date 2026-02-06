export type GetProperty = (key: string) => string | null
export type SetProperty = (key: string, value: string) => void

export class PersistenceHelper {
    private readonly _getProperty: GetProperty
    private readonly _setProperty: SetProperty
    private readonly _prefix: string

    private _matchedInSession: boolean | null = null

    constructor(getProperty: GetProperty, setProperty: SetProperty, prefix: string = '') {
        this._getProperty = getProperty
        this._setProperty = setProperty
        this._prefix = prefix
    }

    // chainable: helper.withPrefix('error_tracking').withPrefix('url')
    withPrefix(prefix: string): PersistenceHelper {
        const newPrefix = this._prefix ? `${this._prefix}_${prefix}` : prefix
        return new PersistenceHelper(this._getProperty, this._setProperty, newPrefix)
    }

    sessionMatchesTrigger(sessionId: string): boolean {
        if (this._matchedInSession === true) {
            return true
        }

        if (this._matchedInSession === null) {
            const key = this._buildKey()
            const matched = this._getProperty(key) === sessionId

            if (matched) {
                this._matchedInSession = true
                return true
            }
        }

        return false
    }

    matchTriggerInSession(sessionId: string): void {
        if (this._matchedInSession === true) {
            return
        }
        this._matchedInSession = true
        const key = this._buildKey()
        this._setProperty(key, sessionId)
    }

    private _buildKey(): string {
        return `$${this._prefix}_session_id`
    }
}
