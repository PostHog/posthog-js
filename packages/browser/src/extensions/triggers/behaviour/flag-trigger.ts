import type { PostHog } from '@posthog/types'
import type { Trigger, TriggerOptions } from './types'

export interface LinkedFlag {
    key: string
    variant?: string | null
}

export class FlagTrigger implements Trigger {
    readonly name = 'flag'
    readonly linkedFlag: LinkedFlag | null

    private readonly _options: TriggerOptions
    private _flagMatches: boolean = false
    private _initialized = false

    constructor(options: TriggerOptions, linkedFlag: LinkedFlag | null) {
        this._options = options
        this.linkedFlag = linkedFlag
    }

    init(): void {
        if (this._initialized) {
            return
        }
        this._initialized = true

        if (this.linkedFlag) {
            this._setupFlagListener(this._options.posthog)
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
        const linkedFlag = this.linkedFlag

        if (!linkedFlag) {
            return
        }

        posthog.onFeatureFlags((_flags: string[], variants: Record<string, unknown>) => {
            if (!variants || !(linkedFlag.key in variants)) {
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
