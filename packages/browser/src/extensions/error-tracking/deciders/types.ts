import type { PostHog } from '../../../posthog-core'
import type { RemoteConfig } from '../../../types'

/**
 * Context provided to each decider during initialization.
 * Contains all dependencies a decider might need, avoiding global access.
 */
export interface DeciderContext {
    /** PostHog instance for accessing properties, feature flags, etc. */
    readonly posthog: PostHog

    /** Window object for URL monitoring, wrapped for testability */
    readonly window: Window | undefined

    /** Logger function for consistent logging across deciders */
    readonly log: (message: string, data?: Record<string, unknown>) => void
}

/**
 * Result of a decider's evaluation.
 */
export interface DeciderResult {
    /** Whether this decider allows capture (true) or blocks it (false) */
    shouldCapture: boolean

    /** Human-readable reason for the decision */
    reason: string
}

/**
 * Interface that all deciders must implement.
 * Each decider is responsible for one specific aspect of ingestion control.
 */
export interface Decider {
    /** Unique name for this decider, used in logging */
    readonly name: string

    /**
     * Initialize the decider with context and config.
     * Called when remote config is received.
     * Deciders should set up any listeners they need here.
     */
    init(context: DeciderContext, config: RemoteConfig): void

    /**
     * Evaluate whether capture should be allowed based on this decider's logic.
     * Returns null if this decider has no opinion (not configured).
     */
    evaluate(): DeciderResult | null

    /**
     * Clean up any resources (listeners, timers, etc.)
     */
    shutdown(): void
}
