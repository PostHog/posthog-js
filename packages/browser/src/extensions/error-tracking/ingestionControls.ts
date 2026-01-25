import type { PostHog } from '../../posthog-core'
import type { RemoteConfig } from '../../types'
import { window as globalWindow } from '../../utils/globals'
import { createLogger } from '../../utils/logger'

import {
    type Decider,
    type DeciderContext,
    type DeciderResult,
    URLDecider,
    FlagDecider,
    SampleDecider,
    EventDecider,
} from './deciders'

const logger = createLogger('[Error Tracking]')

/**
 * Result of the aggregate decision.
 */
export interface AggregateDecision {
    /** Whether capture should proceed */
    shouldCapture: boolean
    /** The decider that made the blocking decision, or 'all_passed' */
    decidedBy: string
    /** Human-readable reason */
    reason: string
}

/**
 * Aggregate Decider - orchestrates all individual deciders.
 *
 * This is the main entry point for ingestion control decisions.
 * It initializes and manages all sub-deciders, and combines their
 * decisions into a final verdict.
 *
 * Architecture:
 * - Each decider is responsible for one aspect of ingestion control
 * - Deciders are initialized with a shared context (no global access)
 * - The aggregate decider queries each decider and combines results
 * - If ANY decider blocks, capture is blocked (AND logic)
 */
export class IngestionControlsAggregateDecider {
    private readonly _posthog: PostHog
    private readonly _deciders: Decider[] = []
    private readonly _urlDecider: URLDecider
    private readonly _eventDecider: EventDecider

    private _context: DeciderContext | null = null
    private _initialized: boolean = false

    constructor(posthog: PostHog) {
        this._posthog = posthog

        // Create all deciders
        this._urlDecider = new URLDecider()
        this._eventDecider = new EventDecider()

        this._deciders = [
            this._urlDecider,
            new FlagDecider(),
            new SampleDecider(),
            this._eventDecider,
        ]

        // Wire up event decider to unblock URL decider when triggered
        this._eventDecider.setTriggerCallback(() => {
            this._urlDecider.unblock()
            this._log('Event trigger fired - URL decider unblocked')
        })
    }

    /**
     * Initialize all deciders with remote config.
     * Called when remote config is received.
     */
    init(config: RemoteConfig): void {
        // Build shared context
        this._context = this._buildContext()

        // Initialize all deciders
        for (const decider of this._deciders) {
            decider.init(this._context, config)
        }

        this._initialized = true
        this._log('Initialized with config', {
            deciders: this._deciders.map((d) => d.name),
        })
    }

    /**
     * Make the aggregate decision about whether to capture.
     *
     * Logic: If ANY decider blocks, capture is blocked.
     * Deciders that return null have no opinion and are skipped.
     */
    decide(): AggregateDecision {
        this._log('Evaluating all deciders')

        // If not initialized, allow capture (fail open)
        if (!this._initialized) {
            this._log('Not initialized - allowing capture')
            return {
                shouldCapture: true,
                decidedBy: 'not_initialized',
                reason: 'Config not received yet, failing open',
            }
        }

        // Evaluate each decider
        const results: { decider: string; result: DeciderResult }[] = []

        for (const decider of this._deciders) {
            const result = decider.evaluate()

            // null = no opinion, skip
            if (result === null) {
                this._log(`[${decider.name}] No opinion (not configured)`)
                continue
            }

            results.push({ decider: decider.name, result })

            this._log(`[${decider.name}] ${result.shouldCapture ? '✓' : '✗'} ${result.reason}`)

            // If this decider blocks, we're done
            if (!result.shouldCapture) {
                this._log(`Decision: BLOCK by ${decider.name}`)
                return {
                    shouldCapture: false,
                    decidedBy: decider.name,
                    reason: result.reason,
                }
            }
        }

        // All deciders passed (or had no opinion)
        this._log('Decision: CAPTURE (all deciders passed)')
        return {
            shouldCapture: true,
            decidedBy: 'all_passed',
            reason: results.length > 0 ? 'All configured deciders allow capture' : 'No deciders configured',
        }
    }

    /**
     * Clean up all deciders.
     */
    shutdown(): void {
        for (const decider of this._deciders) {
            decider.shutdown()
        }
        this._initialized = false
        this._log('Shutdown complete')
    }

    private _buildContext(): DeciderContext {
        return {
            posthog: this._posthog,
            window: globalWindow,
            log: (message: string, data?: Record<string, unknown>) => {
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
