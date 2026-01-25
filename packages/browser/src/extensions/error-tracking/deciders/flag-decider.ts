import type { Decider, DeciderContext } from './types'

/**
 * Flag Decider - evaluates based on feature flag.
 *
 * Returns false if flag is configured but not enabled.
 * Returns null if no flag is configured.
 */
export class FlagDecider implements Decider {
    readonly name = 'flag'

    private _context: DeciderContext | null = null
    private _linkedFlag: string | null = null
    private _flagMatched: boolean = false

    init(context: DeciderContext): void {
        this._context = context
        this._linkedFlag = context.config.errorTracking?.linked_feature_flag ?? null

        if (this._linkedFlag) {
            this._setupFlagListener()
            this._log('Initialized', { linkedFlag: this._linkedFlag })
        }
    }

    shouldCapture(): boolean | null {
        if (!this._linkedFlag) {
            return null
        }
        return this._flagMatched
    }

    private _log(message: string, data?: Record<string, unknown>): void {
        this._context?.log(`[${this.name}] ${message}`, data)
    }

    private _setupFlagListener(): void {
        const posthog = this._context?.posthog
        const flagKey = this._linkedFlag

        if (!posthog || !flagKey) {
            return
        }

        posthog.onFeatureFlags((_flags: string[], variants: Record<string, unknown>) => {
            if (!variants || !(flagKey in variants)) {
                return
            }

            const value = variants[flagKey]
            const matches = value === true || (typeof value === 'string' && value.length > 0)

            this._log('Flag evaluated', { flag: flagKey, value, matches })
            this._flagMatched = matches
        })
    }
}
