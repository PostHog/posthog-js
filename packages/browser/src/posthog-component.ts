import { PostHog } from './posthog-core'
import { PostHogConfig, Property } from './types'

/**
 * Base class for all PostHog components that need access to the PostHog instance.
 * This centralizes the pattern of storing instance and config references.
 */
export abstract class PostHogComponent {
    readonly _instance: PostHog

    get _config(): PostHogConfig {
        return this._instance.config
    }

    constructor(instance: PostHog) {
        this._instance = instance
    }

    ph_property(property_name: string): Property | undefined {
        return this._instance.get_property(property_name)
    }
}
