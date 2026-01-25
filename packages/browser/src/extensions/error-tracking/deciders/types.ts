import type { PostHog } from '../../../posthog-core'
import type { RemoteConfig } from '../../../types'

/**
 * Context provided to each decider during initialization.
 * Contains all dependencies a decider might need.
 */
export interface DeciderContext {
    readonly posthog: PostHog
    readonly window: Window | undefined
    readonly config: RemoteConfig
    readonly log: (message: string, data?: Record<string, unknown>) => void

    /**
     * Callbacks for deciders to notify aggregate of state changes.
     * This allows deciders to remain independent while coordinating through aggregate.
     */
    readonly onBlocklistMatch: () => void
    readonly onTriggerMatch: () => void
}

/**
 * Interface that all deciders must implement.
 */
export interface Decider {
    readonly name: string

    init(context: DeciderContext): void

    /**
     * Returns true to allow, false to block, null for no opinion.
     */
    shouldCapture(): boolean | null
}
