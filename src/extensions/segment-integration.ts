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
import { logger } from '../utils/logger'

import type { Plugin as SegmentPlugin, Context as SegmentContext } from '@segment/analytics-next'

export const createSegmentIntegration = (posthog: PostHog): SegmentPlugin => {
    if (!Promise || !Promise.resolve) {
        logger.warn('This browser does not have Promise support, and can not use the segment integration')
    }

    const enrichEvent = (ctx: SegmentContext, eventName: string | undefined) => {
        if (!eventName) {
            return ctx
        }
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

        const additionalProperties = posthog._calculate_event_properties(eventName, ctx.event.properties ?? {})
        ctx.event.properties = Object.assign({}, additionalProperties, ctx.event.properties)
        return ctx
    }

    return {
        name: 'PostHog JS',
        type: 'enrichment',
        version: '1.0.0',
        isLoaded: () => true,
        // check and early return above
        // eslint-disable-next-line compat/compat
        load: () => Promise.resolve(),
        track: (ctx) => enrichEvent(ctx, ctx.event.event),
        page: (ctx) => enrichEvent(ctx, '$pageview'),
        identify: (ctx) => enrichEvent(ctx, '$identify'),
        screen: (ctx) => enrichEvent(ctx, '$screen'),
    }
}
