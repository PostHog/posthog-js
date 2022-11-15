/**
 * Extend Segment with extra PostHog JS functionality. Required for things like Recordings and feature flags to work correctly.
 *
 * ### Usage
 *
 *  ```js
 *  // After your standard segment anyalytics install
 *  analytics.load("GOEDfA21zZTtR7clsBuDvmBKAtAdZ6Np");
 *
 *  analytics.ready(() => {
 *    posthog.init('<posthog-api-key>', {
 *      capture_pageview: false,
 *      segment: window.analytics, // NOTE: Be sure to use window.analytics here!
 *    });
 *    window.analytics.page();
 *  })
 *  ```
 */
import { PostHog } from '../posthog-core'

// Loosely based on https://github.com/segmentio/analytics-next/blob/master/packages/core/src/plugins/index.ts
interface SegmentPluginContext {
    event: {
        event: string
        userId?: string
        anonymousId?: string
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
        if (!ctx.event.userId && ctx.event.anonymousId !== posthog.get_distinct_id()) {
            // This is our only way of detecting that segment's analytics.reset() has been called so we also call it
            posthog.reset()
        }
        if (ctx.event.userId && ctx.event.userId !== posthog.get_distinct_id()) {
            posthog.register({
                distinct_id: ctx.event.userId,
            })
            posthog.reloadFeatureFlags()
        }

        const additionalProperties = posthog._calculate_event_properties(eventName, ctx.event.properties)
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
