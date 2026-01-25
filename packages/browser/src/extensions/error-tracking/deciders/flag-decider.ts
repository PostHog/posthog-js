import type { RemoteConfig } from '../../../types'
import type { Decider, DeciderContext, DeciderResult } from './types'

/**
 * Flag Decider - handles feature flag based ingestion control.
 *
 * Logic:
 * - If no linked flag configured → no opinion
 * - If flag is not yet evaluated → blocks capture
 * - If flag matches (true or non-empty string) → allows capture
 * - If flag doesn't match → blocks capture
 */
export class FlagDecider implements Decider {
    readonly name = 'flag'

    private _context: DeciderContext | null = null
    private _linkedFlag: string | null = null
    private _flagMatched: boolean = false
    private _cleanupFn: (() => void) | null = null

    init(context: DeciderContext, config: RemoteConfig): void {
        this._context = context
        this._linkedFlag = config.errorTracking?.linked_feature_flag ?? null
        this._flagMatched = false

        if (this._linkedFlag) {
            this._setupFlagListener()
            this._log('Initialized', { linkedFlag: this._linkedFlag })
        }
    }

    evaluate(): DeciderResult | null {
        // No flag configured = no opinion
        if (!this._linkedFlag) {
            return null
        }

        return {
            shouldCapture: this._flagMatched,
            reason: this._flagMatched
                ? `Feature flag "${this._linkedFlag}" is enabled`
                : `Feature flag "${this._linkedFlag}" is not enabled`,
        }
    }

    shutdown(): void {
        this._cleanupFn?.()
        this._cleanupFn = null
        this._flagMatched = false
    }

    private _log(message: string, data?: Record<string, unknown>): void {
        this._context?.log(`[${this.name}] ${message}`, data)
    }

    private _setupFlagListener(): void {
        this._cleanupFn?.()

        const posthog = this._context?.posthog
        const flagKey = this._linkedFlag

        if (!posthog || !flagKey) {
            return
        }

        this._cleanupFn = posthog.onFeatureFlags((_flags: string[], variants: Record<string, unknown>) => {
            if (!variants || !(flagKey in variants)) {
                this._log('Flag not present in response', { flag: flagKey })
                return
            }

            const value = variants[flagKey]
            const matches = this._evaluateFlagValue(value)

            this._log('Flag evaluated', {
                flag: flagKey,
                value,
                matches,
                previouslyMatched: this._flagMatched,
            })

            if (matches && !this._flagMatched) {
                this._flagMatched = true
                this._log('Flag MATCHED - capture enabled', { flag: flagKey })
            } else if (!matches && this._flagMatched) {
                this._flagMatched = false
                this._log('Flag UNMATCHED - capture disabled', { flag: flagKey })
            }
        })
    }

    private _evaluateFlagValue(value: unknown): boolean {
        if (typeof value === 'boolean') {
            return value === true
        }
        if (typeof value === 'string') {
            return value.length > 0
        }
        return false
    }
}
