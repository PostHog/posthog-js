export type GetProperty = (key: string) => unknown
export type SetProperty = (key: string, value: unknown) => void

export enum TriggerState {
    Triggered = 'triggered',
    NotTriggeredYet = 'not_triggered_yet',
    ExplicitlyDisabled = 'explicitly_disabled', // this is for sample rate trigger where lack of decision and negative decision mean different things
}

interface StoredDecision {
    sessionId: string
    result: TriggerState
}

export class PersistenceHelper {
    private readonly _getProperty: GetProperty
    private readonly _setProperty: SetProperty
    private readonly _prefix: string

    private _cachedDecision: StoredDecision | null = null

    constructor(getProperty: GetProperty, setProperty: SetProperty, prefix: string = '') {
        this._getProperty = getProperty
        this._setProperty = setProperty
        this._prefix = prefix
    }

    withPrefix(prefix: string): PersistenceHelper {
        const newPrefix = this._prefix ? `${this._prefix}_${prefix}` : prefix
        return new PersistenceHelper(this._getProperty, this._setProperty, newPrefix)
    }

    /**
     * Returns the decision for the given session.
     * - `DecisionResult.Triggered` if triggered
     * - `DecisionResult.NotTriggered` if explicitly not triggered
     * - `null` if no decision exists for this session
     */
    getDecision(sessionId: string): TriggerState | null {
        // Check in-memory cache first
        if (this._cachedDecision?.sessionId === sessionId) {
            return this._cachedDecision.result
        }

        // Check persistence
        const persisted = this._getPersistedDecision()
        if (persisted?.sessionId === sessionId) {
            this._cachedDecision = persisted
            return persisted.result
        }

        return null
    }

    setDecision(sessionId: string, result: TriggerState): void {
        // Idempotent - don't re-persist if already set to same value
        if (this._cachedDecision?.sessionId === sessionId && this._cachedDecision.result === result) {
            return
        }
        this._cachedDecision = { sessionId, result }
        this._persistDecision(this._cachedDecision)
    }

    /**
     * Convenience method: Returns true if the trigger was triggered for this session.
     * For triggers that only ever become triggered (url, event).
     */
    isTriggered(sessionId: string): boolean {
        return this.getDecision(sessionId) === TriggerState.Triggered
    }

    private _getPersistedDecision(): StoredDecision | null {
        const key = this._buildKey()
        const value = this._getProperty(key)
        if (
            value &&
            typeof value === 'object' &&
            'sessionId' in value &&
            'result' in value &&
            Object.values(TriggerState).includes((value as StoredDecision).result)
        ) {
            return value as StoredDecision
        }
        return null
    }

    private _persistDecision(decision: StoredDecision): void {
        const key = this._buildKey()
        this._setProperty(key, decision)
    }

    private _buildKey(): string {
        return `$${this._prefix}_decision`
    }
}
