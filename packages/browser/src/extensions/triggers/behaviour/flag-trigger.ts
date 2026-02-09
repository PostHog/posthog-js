import type { PostHog } from '@posthog/types'
import type { Trigger, TriggerOptions } from './types'

export interface LinkedFlag {
    key: string
    variant?: string | null
}

export class FlagTrigger implements Trigger {
    readonly name = 'flag'
    linkedFlag: LinkedFlag | null = null

    private readonly _posthog: PostHog
    private _flagMatches: boolean = false
    private _listenerAttached = false

    constructor(options: TriggerOptions) {
        this._posthog = options.posthog
    }

    init(linkedFlag: LinkedFlag | null): void {
        this.linkedFlag = linkedFlag
        this._flagMatches = false

        if (!this._listenerAttached && this.linkedFlag) {
            this._listenerAttached = true
            this._setupFlagListener(this._posthog)
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    matches(_sessionId: string): boolean | null {
        if (!this.linkedFlag) {
            return null
        }

        return this._flagMatches
    }

    private _setupFlagListener(posthog: PostHog): void {
        posthog.onFeatureFlags((_flags: string[], variants: Record<string, unknown>) => {
            const linkedFlag = this.linkedFlag

            if (!linkedFlag || !variants || !(linkedFlag.key in variants)) {
                return
            }

            const value = variants[linkedFlag.key]

            if (linkedFlag.variant) {
                this._flagMatches = value === linkedFlag.variant
            } else {
                this._flagMatches = value === true || (typeof value === 'string' && value.length > 0)
            }
        })
    }
}
