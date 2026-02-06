import { isNull } from '@posthog/core'
import type { Trigger, TriggerOptions } from './types'
import type { PersistenceHelper } from './persistence'

export class SampleTrigger implements Trigger {
    readonly name = 'sample'

    private readonly _sampleRate: number | null
    private readonly _persistence: PersistenceHelper

    constructor(options: TriggerOptions, sampleRate: number | null) {
        this._sampleRate = sampleRate
        this._persistence = options.persistence.withPrefix('sample')
    }

    matches(sessionId: string): boolean | null {
        if (isNull(this._sampleRate)) {
            return null
        }

        // Check if already sampled for this session (from persistence or in-memory)
        if (this._persistence.sessionMatchesTrigger(sessionId)) {
            return true
        }

        // Make sampling decision
        const sampled = Math.random() < this._sampleRate

        if (sampled) {
            this._persistence.matchTriggerInSession(sessionId)
        }

        return sampled
    }
}
