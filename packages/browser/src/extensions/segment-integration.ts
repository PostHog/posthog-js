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
import { createLogger } from '@posthog/browser-common/utils/logger'

import { EVENT_IDENTIFY, EVENT_PAGEVIEW, USER_STATE, USER_STATE_IDENTIFIED } from '../constants'
import { hasOwnProperty, isArray, isFunction, isNullish } from '@posthog/core'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'

import type {
    SegmentUser,
    SegmentAnalytics,
    SegmentContext,
    SegmentPlugin,
    SegmentEnrichmentFilterFn,
    SegmentIntegrationConfig,
    Properties,
} from '@posthog/types'

// Re-export for backwards compatibility
export type {
    SegmentUser,
    SegmentAnalytics,
    SegmentContext,
    SegmentPlugin,
    SegmentEnrichmentFilterFn,
    SegmentIntegrationConfig,
}

type SegmentIntegrationUser = Awaited<ReturnType<SegmentAnalytics['user']>>

const logger = createLogger('[SegmentIntegration]')

const isSegmentAnalytics = (segment: SegmentAnalytics | SegmentIntegrationConfig): segment is SegmentAnalytics =>
    isFunction((segment as SegmentAnalytics).register)

const normalizeSegmentIntegrationConfig = (
    segment: SegmentAnalytics | SegmentIntegrationConfig
): SegmentIntegrationConfig => {
    return isSegmentAnalytics(segment) ? { analytics: segment } : segment
}

const runSegmentPropertyFilters = (
    filters: SegmentEnrichmentFilterFn | SegmentEnrichmentFilterFn[],
    properties: Properties
): Properties | null => {
    const fns = isArray(filters) ? filters : [filters]
    let result: Properties | null = { ...properties }

    for (const fn of fns) {
        try {
            result = fn(result)
            if (isNullish(result)) {
                return null
            }
        } catch (error) {
            logger.error('Error in Segment filterProperties:', error)
            return null
        }
    }

    return result
}

const createSegmentIntegration = (
    posthog: PostHog,
    { filterProperties }: Pick<SegmentIntegrationConfig, 'filterProperties'> = {}
): SegmentPlugin => {
    if (typeof Promise === 'undefined' || !Promise.resolve) {
        logger.warn('This browser does not have Promise support, and can not use the segment integration')
    }

    const enrichEvent = (ctx: SegmentContext, eventName: string | undefined) => {
        if (!eventName) {
            return ctx
        }
        if (!ctx.event.userId && ctx.event.anonymousId !== posthog.get_distinct_id()) {
            // This is our only way of detecting that segment's analytics.reset() has been called so we also call it
            logger.info('No userId set, resetting PostHog')
            posthog.reset()
        }
        if (ctx.event.userId && ctx.event.userId !== posthog.get_distinct_id()) {
            logger.info('UserId set, identifying with PostHog')
            posthog.identify(ctx.event.userId)
        }

        let additionalProperties = posthog.calculateEventProperties(eventName, ctx.event.properties)
        if (!isNullish(filterProperties)) {
            const originalProperties = ctx.event.properties || {}
            const enrichmentProperties: Properties = {}
            for (const key of Object.keys(additionalProperties)) {
                if (!hasOwnProperty.call(originalProperties, key)) {
                    enrichmentProperties[key] = additionalProperties[key]
                }
            }

            const filteredProperties = runSegmentPropertyFilters(filterProperties, enrichmentProperties)
            if (isNullish(filteredProperties)) {
                return ctx
            }
            additionalProperties = filteredProperties
        }
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
        page: (ctx) => enrichEvent(ctx, EVENT_PAGEVIEW),
        identify: (ctx) => enrichEvent(ctx, EVENT_IDENTIFY),
        screen: (ctx) => enrichEvent(ctx, '$screen'),
    }
}

function setupPostHogFromSegment(posthog: PostHog, segment: SegmentAnalytics, done: () => void) {
    const bootstrapUser = (user: SegmentIntegrationUser) => {
        // Use segments anonymousId instead
        const getSegmentAnonymousId = () => user.anonymousId() || uuidv7()
        posthog.config.get_device_id = getSegmentAnonymousId

        // If a segment user ID exists, set it as the distinct_id
        if (user.id()) {
            posthog.register({
                distinct_id: user.id(),
                $device_id: getSegmentAnonymousId(),
            })
            posthog.persistence!.set_property(USER_STATE, USER_STATE_IDENTIFIED)
        }

        done()
    }

    const segmentUser = segment.user()
    if ('then' in segmentUser && isFunction(segmentUser.then)) {
        segmentUser.then(bootstrapUser)
    } else {
        bootstrapUser(segmentUser as SegmentIntegrationUser)
    }
}

export function setupSegmentIntegration(posthog: PostHog, done: () => void) {
    const segmentConfig = posthog.config.segment
    if (!segmentConfig) {
        return done()
    }

    const { analytics, filterProperties } = normalizeSegmentIntegrationConfig(segmentConfig)
    setupPostHogFromSegment(posthog, analytics, () => {
        analytics.register(createSegmentIntegration(posthog, { filterProperties })).then(() => {
            done()
        })
    })
}
