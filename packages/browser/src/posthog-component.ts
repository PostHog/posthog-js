import { PostHog } from './posthog-core'
import { PostHogConfig, Properties, Property } from './types'

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
    /**
     * the posthog instance this component belongs to
     */
    readonly i: PostHog

    /**
     * the config for the posthog instance this component belongs to
     */
    get c(): PostHogConfig {
        return this.i.config
    }

    constructor(instance: PostHog) {
        this.i = instance
    }

    /**
     * get a property from the posthog instance's persistence properties
     * @param property_name
     */
    get_prop(property_name: string): Property | undefined {
        return this.i.get_property(property_name)
    }

    /**
     * register properties on the posthog instance
     * registered properties are sent on every event
     */
    reg_property(props: Properties, days?: number): boolean {
        return this.i.persistence?.register(props, days) ?? false
    }
}
