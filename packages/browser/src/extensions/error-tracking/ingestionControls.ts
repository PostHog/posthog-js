import type { PostHog } from '../../posthog-core'
import type { RemoteConfig } from '../../types'
import { window as globalWindow } from '../../utils/globals'
import { createLogger } from '../../utils/logger'

import type { Decider, DeciderContext } from './deciders/types'
import { URLDecider } from './deciders/url-decider'
import { FlagDecider } from './deciders/flag-decider'
import { SampleDecider } from './deciders/sample-decider'
import { EventDecider } from './deciders/event-decider'

const logger = createLogger('[Error Tracking]')

/**
 * Aggregate Decider - orchestrates all individual deciders.
 *
 * Maintains the blocked state which can be set by URL blocklist
 * and cleared by URL triggers or event triggers.
 *
 * Decision logic:
 * 1. If blocked → don't capture
 * 2. If any decider returns false → don't capture
 * 3. Otherwise → capture
 */
export class IngestionControlsAggregateDecider {
    private readonly _posthog: PostHog
    private readonly _deciders: Decider[] = []

    private _blocked: boolean = false
    private _initialized: boolean = false

    constructor(posthog: PostHog) {
        this._posthog = posthog
    }

    init(config: RemoteConfig): void {
        const context = this._buildContext(config)

        // Create and init all deciders
        this._deciders.length = 0
        this._deciders.push(
            new URLDecider(),
            new EventDecider(),
            new FlagDecider(),
            new SampleDecider()
        )

        for (const decider of this._deciders) {
            decider.init(context)
        }

        this._initialized = true
        this._log('Initialized', { deciders: this._deciders.map((d) => d.name) })
    }

    decide(): boolean {
        if (!this._initialized) {
            this._log('Not initialized - allowing capture')
            return true
        }

        // Check blocked state (set by URL blocklist, cleared by triggers)
        if (this._blocked) {
            this._log('Blocked by URL blocklist')
            return false
        }

        // Check each decider
        for (const decider of this._deciders) {
            const result = decider.shouldCapture()

            if (result === null) {
                continue
            }

            this._log(`[${decider.name}] ${result ? '✓' : '✗'}`)

            if (!result) {
                this._log(`Blocked by ${decider.name}`)
                return false
            }
        }

        this._log('All checks passed - capturing')
        return true
    }

    private _buildContext(config: RemoteConfig): DeciderContext {
        return {
            posthog: this._posthog,
            window: globalWindow,
            config,
            log: (message, data) => {
                if (data) {
                    logger.info(message, data)
                } else {
                    logger.info(message)
                }
            },
            onBlocklistMatch: () => {
                this._blocked = true
                this._log('State: BLOCKED (blocklist match)')
            },
            onTriggerMatch: () => {
                this._blocked = false
                this._log('State: UNBLOCKED (trigger match)')
            },
        }
    }

    private _log(message: string, data?: Record<string, unknown>): void {
        if (data) {
            logger.info(`[Aggregate] ${message}`, data)
        } else {
            logger.info(`[Aggregate] ${message}`)
        }
    }
}
