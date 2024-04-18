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

import { uuidv7 } from '../uuidv7'
import { isFunction } from '../utils/type-utils'

export type SegmentUser = {
    anonymousId(): string | undefined
    id(): string | undefined
}

export type SegmentAnalytics = {
    user: () => SegmentUser | Promise<SegmentUser>
    register: (integration: SegmentPlugin) => Promise<void>
}

// Loosely based on https://github.com/segmentio/analytics-next/blob/master/packages/core/src/plugins/index.ts
interface SegmentContext {
    event: {
        event: string
        userId?: string
        anonymousId?: string
        properties: any
    }
}

type SegmentFunction = (ctx: SegmentContext) => Promise<SegmentContext> | SegmentContext

interface SegmentPlugin {
    name: string
    version: string
    type: 'enrichment'
    isLoaded: () => boolean
    load: (ctx: SegmentContext, instance: any, config?: any) => Promise<unknown>
    unload?: (ctx: SegmentContext, instance: any) => Promise<unknown> | unknown
    ready?: () => Promise<unknown>
    track?: SegmentFunction
    identify?: SegmentFunction
    page?: SegmentFunction
    group?: SegmentFunction
    alias?: SegmentFunction
    screen?: SegmentFunction
}

const createSegmentIntegration = (posthog: PostHog): SegmentPlugin => {
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

function setupPostHogFromSegment(posthog: PostHog, done: () => void) {
    const segment = posthog.config.segment
    if (!segment) {
        return done()
    }

    const bootstrapUser = (user: SegmentUser) => {
        // Use segments anonymousId instead
        const getSegmentAnonymousId = () => user.anonymousId() || uuidv7()
        posthog.config.get_device_id = getSegmentAnonymousId

        // If a segment user ID exists, set it as the distinct_id
        if (user.id()) {
            posthog.register({
                distinct_id: user.id(),
                $device_id: getSegmentAnonymousId(),
            })
            posthog.persistence!.set_user_state('identified')
        }

        done()
    }

    const segmentUser = segment.user()

    // If segmentUser is a promise then we need to wait for it to resolve
    if ('then' in segmentUser && isFunction(segmentUser.then)) {
        segmentUser.then((user) => bootstrapUser(user))
    } else {
        bootstrapUser(segmentUser as SegmentUser)
    }
}

export function setupSegmentIntegration(posthog: PostHog, done: () => void) {
    const segment = posthog.config.segment
    if (!segment) {
        return done()
    }

    setupPostHogFromSegment(posthog, () => {
        segment.register(createSegmentIntegration(posthog)).then(() => {
            done()
        })
    })
}
