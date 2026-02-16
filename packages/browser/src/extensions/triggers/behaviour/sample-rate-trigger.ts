import { isNull } from '@posthog/core'
import type { Trigger, TriggerOptions } from './types'
import type { PersistenceHelper } from './persistence'

interface SamplingDecision {
    sessionId: string
    sampled: boolean
}

export class SampleRateTrigger implements Trigger {
    readonly name = 'sample-rate'
    sampleRate: number | null = null

    private readonly _persistence: PersistenceHelper

    // In-memory cache of the sampling decision
    private _decision: SamplingDecision | null = null

    constructor(options: TriggerOptions) {
        this._persistence = options.persistence.withPrefix('sample')
    }

    init(sampleRate: number | null): void {
        this.sampleRate = sampleRate
        this._decision = null
    }

    clearPersistedState(): void {
        this._decision = null
        this._persistence.clearWithSufix('decision')
    }

    matches(sessionId: string): boolean | null {
        if (isNull(this.sampleRate)) {
            return null
        }

        // Check in-memory cache first
        if (this._decision?.sessionId === sessionId) {
            return this._decision.sampled
        }

        // Check persistence
        const persisted = this._persistence.get<SamplingDecision>('decision')
        if (persisted?.sessionId === sessionId) {
            this._decision = persisted
            return persisted.sampled
        }

        // Make new sampling decision
        const sampled = Math.random() < this.sampleRate
        this._decision = { sessionId, sampled }
        this._persistence.set('decision', this._decision)

        return sampled
    }
}
