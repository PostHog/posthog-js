import { isNull } from '@posthog/core'
import type { Trigger, TriggerOptions } from './types'
import { TriggerState, type PersistenceHelper } from './persistence'

export class SampleTrigger implements Trigger {
    readonly name = 'sample'
    readonly sampleRate: number | null

    private readonly _persistence: PersistenceHelper

    constructor(options: TriggerOptions, sampleRate: number | null) {
        this.sampleRate = sampleRate
        this._persistence = options.persistence.withPrefix('sample')
    }

    matches(sessionId: string): boolean | null {
        if (isNull(this.sampleRate)) {
            return null
        }

        // Check if we already have a decision for this session
        const existingDecision = this._persistence.getDecision(sessionId)
        if (existingDecision !== null) {
            return existingDecision === TriggerState.Triggered
        }

        // Make new sampling decision
        const sampled = Math.random() < this.sampleRate
        const result = sampled ? TriggerState.Triggered : TriggerState.NotTriggeredYet
        this._persistence.setDecision(sessionId, result)

        return sampled
    }
}
