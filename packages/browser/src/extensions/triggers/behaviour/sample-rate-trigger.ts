import { isNull } from '@posthog/core'
import type { PostHog } from '@posthog/types'
import type { Trigger, TriggerOptions } from './types'

interface SamplingDecision {
    sessionId: string
    sampled: boolean
}

export class SampleRateTrigger implements Trigger {
    readonly name = 'sample'
    readonly sampleRate: number | null

    private readonly _posthog: PostHog
    private readonly _persistenceKey: string

    // In-memory cache of the sampling decision
    private _decision: SamplingDecision | null = null

    constructor(options: TriggerOptions, sampleRate: number | null, persistenceKey: string) {
        this.sampleRate = sampleRate
        this._posthog = options.posthog
        this._persistenceKey = persistenceKey
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
        const persisted = this._getPersistedDecision()
        if (persisted?.sessionId === sessionId) {
            this._decision = persisted
            return persisted.sampled
        }

        // Make new sampling decision
        const sampled = Math.random() < this.sampleRate
        this._decision = { sessionId, sampled }
        this._persistDecision(this._decision)

        return sampled
    }

    private _getPersistedDecision(): SamplingDecision | null {
        const value = this._posthog.get_property(this._persistenceKey)
        if (value && typeof value === 'object' && 'sessionId' in value && 'sampled' in value) {
            return value as SamplingDecision
        }
        return null
    }

    private _persistDecision(decision: SamplingDecision): void {
        this._posthog.persistence?.register({ [this._persistenceKey]: decision })
    }
}
