import type { PostHog } from '@posthog/types'
import type { Trigger, FlagTriggerOptions } from './types'

export interface LinkedFlag {
    key: string
    variant?: string | null
}

export class FlagTrigger implements Trigger {
    readonly name = 'flag'

    private _posthog: PostHog | null = null
    private _linkedFlag: LinkedFlag | null = null
    private _flagMatched: boolean = false

    init(linkedFlag: LinkedFlag | null, options: FlagTriggerOptions): void {
        this._posthog = options.posthog
        this._linkedFlag = linkedFlag

        if (this._linkedFlag) {
            this._setupFlagListener()
        }
    }

    shouldCapture(): boolean | null {
        if (!this._linkedFlag) {
            return null
        }
        return this._flagMatched
    }

    private _setupFlagListener(): void {
        const posthog = this._posthog
        const linkedFlag = this._linkedFlag

        if (!posthog || !linkedFlag) {
            return
        }

        posthog.onFeatureFlags((_flags: string[], variants: Record<string, unknown>) => {
            if (!variants || !(linkedFlag.key in variants)) {
                return
            }

            const value = variants[linkedFlag.key]
            let matches: boolean

            if (linkedFlag.variant) {
                matches = value === linkedFlag.variant
            } else {
                matches = value === true || (typeof value === 'string' && value.length > 0)
            }

            this._flagMatched = matches
        })
    }
}
