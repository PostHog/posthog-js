/**
 * Integrate Sentry with PostHog. This will add a direct link to the person in Sentry, and an $exception event in PostHog
 *
 * ### Usage
 *
 *     Sentry.init({
 *          dsn: 'https://example',
 *          integrations: [
 *              new posthog.SentryIntegration(posthog)
 *          ]
 *     })
 *
 * @param {Object} [posthog] The posthog object
 * @param {string} [organization] Optional: The Sentry organization, used to send a direct link from PostHog to Sentry
 * @param {Number} [projectId] Optional: The Sentry project id, used to send a direct link from PostHog to Sentry
 * @param {string} [prefix] Optional: Url of a self-hosted sentry instance (default: https://sentry.io/organizations/)
 */
import { PostHog } from '../posthog-core'

// Loosely based on https://github.com/segmentio/analytics-next/blob/master/packages/core/src/plugins/index.ts
interface SegmentPluginContext {
    event: {
        event: string
        properties: any
    }
}

interface SegmentPlugin {
    name: string
    version: string
    type: 'enrichment'
    isLoaded: () => boolean
    load: (ctx: SegmentPluginContext, instance: any, config?: any) => Promise<unknown>
    unload?: (ctx: SegmentPluginContext, instance: any) => Promise<unknown> | unknown
    ready?: () => Promise<unknown>
    track?: (ctx: SegmentPluginContext) => Promise<SegmentPluginContext> | SegmentPluginContext
    identify?: (ctx: SegmentPluginContext) => Promise<SegmentPluginContext> | SegmentPluginContext
    page?: (ctx: SegmentPluginContext) => Promise<SegmentPluginContext> | SegmentPluginContext
    group?: (ctx: SegmentPluginContext) => Promise<SegmentPluginContext> | SegmentPluginContext
    alias?: (ctx: SegmentPluginContext) => Promise<SegmentPluginContext> | SegmentPluginContext
    screen?: (ctx: SegmentPluginContext) => Promise<SegmentPluginContext> | SegmentPluginContext
}

export const createSegmentIntegration = (posthog: PostHog): SegmentPlugin => {
    const enrichEvent = (ctx: SegmentPluginContext, eventName: string) => {
        const additionalProperties = posthog._calculate_event_properties(eventName, ctx.event.properties)
        console.log('Enriching', eventName, ctx.event.properties, additionalProperties)
        ctx.event.properties = Object.assign({}, additionalProperties, ctx.event.properties)
        return ctx
    }

    return {
        name: 'PostHog JS',
        type: 'enrichment',
        version: '1.0.0',

        isLoaded: () => true,
        load: () => Promise.resolve(),
        track: (ctx) => enrichEvent(ctx, ctx.event.event),
        page: (ctx) => enrichEvent(ctx, '$pageview'),
        identify: (ctx) => enrichEvent(ctx, '$identify'),
        screen: (ctx) => enrichEvent(ctx, '$screen'),
    }
}
