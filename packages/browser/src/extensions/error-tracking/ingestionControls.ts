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
 * Decision logic: If ANY decider returns false → don't capture.
 * Deciders returning null have no opinion and are skipped.
 */
export class IngestionControlsAggregateDecider {
    private readonly _posthog: PostHog
    private readonly _deciders: Decider[] = []

    private _initialized: boolean = false

    constructor(posthog: PostHog) {
        this._posthog = posthog
    }

    init(config: RemoteConfig): void {
        const context = this._buildContext(config)

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

        this._log('All checks passed')
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
