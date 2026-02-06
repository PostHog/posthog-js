import { isNull } from '@posthog/core'
import type { PostHog } from '../../../posthog-core'
import type { Trigger, TriggerOptions } from './types'

interface SamplingDecision {
    sessionId: string
    sampled: boolean
}

const PERSISTENCE_KEY = '$error_tracking_sample_decision'

export class SampleTrigger implements Trigger {
    readonly name = 'sample'
    readonly sampleRate: number | null

    private readonly _posthog: PostHog

    // In-memory cache of the sampling decision
    private _decision: SamplingDecision | null = null

    constructor(options: TriggerOptions, sampleRate: number | null) {
        this.sampleRate = sampleRate
        this._posthog = options.posthog
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
        const value = this._posthog.get_property(PERSISTENCE_KEY)
        if (value && typeof value === 'object' && 'sessionId' in value && 'sampled' in value) {
            return value as SamplingDecision
        }
        return null
    }

    private _persistDecision(decision: SamplingDecision): void {
        this._posthog.persistence?.register({ [PERSISTENCE_KEY]: decision })
    }
}
