import type { PostHog } from '../../../posthog-core'
import type { RemoteConfig } from '../../../types'

/**
 * Context provided to each decider during initialization.
 */
export interface DeciderContext {
    readonly posthog: PostHog
    readonly window: Window | undefined
    readonly config: RemoteConfig
    readonly log: (message: string, data?: Record<string, unknown>) => void
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
