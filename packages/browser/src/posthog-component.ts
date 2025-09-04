import { PostHog } from './posthog-core'
import { PostHogConfig } from './types'

/**
 * Base class for all PostHog components that need access to the PostHog instance.
 * This centralizes the pattern of storing instance and config references.
 */
export abstract class PostHogComponent {
    readonly _instance: PostHog
    readonly _config: PostHogConfig

    protected constructor(instance: PostHog) {
        this._instance = instance
        this._config = instance.config
    }
}
