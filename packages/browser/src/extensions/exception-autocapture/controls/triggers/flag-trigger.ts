import type { PostHog } from '@posthog/types'
import type { Trigger, TriggerOptions } from './types'
import type { PersistenceHelper } from './persistence'

export interface LinkedFlag {
    key: string
    variant?: string | null
}

export class FlagTrigger implements Trigger {
    readonly name = 'flag'

    private readonly _linkedFlag: LinkedFlag | null
    private readonly _persistence: PersistenceHelper

    constructor(options: TriggerOptions, linkedFlag: LinkedFlag | null) {
        this._linkedFlag = linkedFlag
        this._persistence = options.persistence.withPrefix('flag')

        if (this._linkedFlag) {
            this._setupFlagListener(options.posthog)
        }
    }

    matches(sessionId: string): boolean | null {
        if (!this._linkedFlag) {
            return null
        }

        return this._persistence.sessionMatchesTrigger(sessionId) ? true : false
    }

    private _setupFlagListener(posthog: PostHog): void {
        const linkedFlag = this._linkedFlag

        if (!linkedFlag) {
            return
        }

        posthog.onFeatureFlags((_flags: string[], variants: Record<string, unknown>) => {
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
                this._persistence.matchTriggerInSession(posthog.get_session_id())
            }
        })
    }
}
