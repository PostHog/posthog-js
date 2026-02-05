import { isNull } from '@posthog/core'
import type { Trigger, LogFn, GetPersistedSessionId, SetPersistedSessionId } from './types'

export interface SampleTriggerOptions {
    readonly log: LogFn
    readonly getPersistedSessionId?: GetPersistedSessionId
    readonly setPersistedSessionId?: SetPersistedSessionId
}

export class SampleTrigger implements Trigger {
    readonly name = 'sample'

    private _sampleRate: number | null = null
    private _sampledSessionId: string | null = null
    private _sampled: boolean = false
    private _getPersistedSessionId: GetPersistedSessionId | undefined
    private _setPersistedSessionId: SetPersistedSessionId | undefined

    init(sampleRate: number | null, options: SampleTriggerOptions): void {
        this._sampleRate = sampleRate
        this._sampledSessionId = null
        this._sampled = false
        this._getPersistedSessionId = options.getPersistedSessionId
        this._setPersistedSessionId = options.setPersistedSessionId
    }

    matches(sessionId: string): boolean | null {
        if (isNull(this._sampleRate)) {
            return null
        }

        // Check if already sampled for this session (from persistence)
        const persistedSessionId = this._getPersistedSessionId?.()
        if (persistedSessionId === sessionId) {
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
            this._setPersistedSessionId?.(sessionId)
        }

        return this._sampled
    }
}
