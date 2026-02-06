import { isNull } from '@posthog/core'
import type { Trigger, TriggerOptions } from './types'
import type { PersistenceHelper } from './persistence'

export class SampleTrigger implements Trigger {
    readonly name = 'sample'

    private readonly _sampleRate: number | null
    private readonly _persistence: PersistenceHelper

    private _sampledSessionId: string | null = null
    private _sampled: boolean = false

    constructor(options: TriggerOptions, sampleRate: number | null) {
        this._sampleRate = sampleRate
        this._persistence = options.persistenceHelperFactory.create('sample')
    }

    matches(sessionId: string): boolean | null {
        if (isNull(this._sampleRate)) {
            return null
        }

        // Check if already sampled for this session (from persistence)
        if (this._persistence.sessionMatchesTrigger(sessionId)) {
            return true
        }

        // Already sampled in-memory for this session
        if (this._sampledSessionId === sessionId) {
            return this._sampled
        }

        // New session, make sampling decision
        this._sampledSessionId = sessionId
        this._sampled = Math.random() < this._sampleRate

        if (this._sampled) {
            this._persistence.matchTriggerInSession(sessionId)
        }

        return this._sampled
    }
}
