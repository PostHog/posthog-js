import type { PostHog } from '@posthog/types'
import type { Trigger, LogFn, GetPersistedSessionId, SetPersistedSessionId } from './types'

export interface LinkedFlag {
    key: string
    variant?: string | null
}

export interface FlagTriggerOptions {
    readonly posthog: PostHog
    readonly log: LogFn
    readonly getPersistedSessionId?: GetPersistedSessionId
    readonly setPersistedSessionId?: SetPersistedSessionId
}

export class FlagTrigger implements Trigger {
    readonly name = 'flag'

    private _posthog: PostHog | null = null
    private _linkedFlag: LinkedFlag | null = null
    private _matchedFlagInSession: boolean = false
    private _initialized: boolean = false
    private _unsubscribe: (() => void) | null = null
    private _getPersistedSessionId: GetPersistedSessionId | undefined
    private _setPersistedSessionId: SetPersistedSessionId | undefined

    init(linkedFlag: LinkedFlag | null, options: FlagTriggerOptions): void {
        if (this._initialized) {
            this._teardownFlagListener()
        }

        this._posthog = options.posthog
        this._linkedFlag = linkedFlag
        this._matchedFlagInSession = false
        this._getPersistedSessionId = options.getPersistedSessionId
        this._setPersistedSessionId = options.setPersistedSessionId

        if (this._linkedFlag) {
            this._setupFlagListener()
        }

        this._initialized = true
    }

    matches(sessionId: string): boolean | null {
        if (!this._linkedFlag) {
            return null
        }

        // Check if already triggered for this session (from persistence)
        const persistedSessionId = this._getPersistedSessionId?.()
        if (persistedSessionId === sessionId) {
            return true
        }

        // Check if we matched flag in this session (in-memory)
        if (this._matchedFlagInSession) {
            this._setPersistedSessionId?.(sessionId)
            return true
        }

        return false
    }

    private _setupFlagListener(): void {
        const posthog = this._posthog
        const linkedFlag = this._linkedFlag

        if (!posthog || !linkedFlag) {
            return
        }

        this._unsubscribe = posthog.onFeatureFlags((_flags: string[], variants: Record<string, unknown>) => {
            if (this._matchedFlagInSession) {
                return // Already matched
            }

            if (!variants || !(linkedFlag.key in variants)) {
                return
            }

            const value = variants[linkedFlag.key]
            let flagMatches: boolean

            if (linkedFlag.variant) {
                flagMatches = value === linkedFlag.variant
            } else {
                flagMatches = value === true || (typeof value === 'string' && value.length > 0)
            }

            if (flagMatches) {
                this._matchedFlagInSession = true
            }
        })
    }

    private _teardownFlagListener(): void {
        if (this._unsubscribe) {
            this._unsubscribe()
            this._unsubscribe = null
        }
    }
}
