import type { Decider, DeciderContext } from './types'

export class FlagDecider implements Decider {
    readonly name = 'flag'

    private _context: DeciderContext | null = null
    private _linkedFlag: { key: string; variant?: string | null } | null = null
    private _flagMatched: boolean = false

    init(context: DeciderContext): void {
        this._context = context
        this._linkedFlag = context.config?.linkedFeatureFlag ?? null

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
        const posthog = this._context?.posthog
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
