import { PostHog } from './posthog-core'
import { PostHogConfig, Property } from './types'

/**
 * Base class for all PostHog components that need access to the PostHog instance.
 * This centralizes the pattern of storing instance and config references.
 *
 * We do this because our bundler can't minify class fields well.
 * So, we end up with repeated calls like `this._instance.config` inflating the bundle size
 *
 * By centralising here we can _at least_ reduce that repeated string length
 * And future improvements can be made in one place
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
