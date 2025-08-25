import { window } from './utils/globals'
import { PostHog } from './posthog-core'
import { clampToRange, isUndefined } from '@posthog/core'
import { extend } from './utils'
import { logger } from './utils/logger'

interface PageViewEventProperties {
    $pageview_id?: string
    $prev_pageview_id?: string
    $prev_pageview_pathname?: string
    $prev_pageview_duration?: number // seconds
    $prev_pageview_last_scroll?: number
    $prev_pageview_last_scroll_percentage?: number
    $prev_pageview_max_scroll?: number
    $prev_pageview_max_scroll_percentage?: number
    $prev_pageview_last_content?: number
    $prev_pageview_last_content_percentage?: number
    $prev_pageview_max_content?: number
    $prev_pageview_max_content_percentage?: number
}

// This keeps track of the PageView state (such as the previous PageView's path, timestamp, id, and scroll properties).
// We store the state in memory, which means that for non-SPA sites, the state will be lost on page reload. This means
// that non-SPA sites should always send a $pageleave event on any navigation, before the page unloads. For SPA sites,
// they only need to send a $pageleave event when the user navigates away from the site, as the information is not lost
// on an internal navigation, and is included as the $prev_pageview_ properties in the next $pageview event.

// Practically, this means that to find the scroll properties for a given pageview, you need to find the event where
// event name is $pageview or $pageleave and where $prev_pageview_id matches the original pageview event's id.

export class PageViewManager {
    _currentPageview?: { timestamp: Date; pageViewId: string | undefined; pathname: string | undefined }
    _instance: PostHog

    constructor(instance: PostHog) {
        this._instance = instance
    }

    doPageView(timestamp: Date, pageViewId?: string): PageViewEventProperties {
        const response = this._previousPageViewProperties(timestamp, pageViewId)

        // On a pageview we reset the contexts
        this._currentPageview = { pathname: window?.location.pathname ?? '', pageViewId, timestamp }
        this._instance.scrollManager.resetContext()

        return response
    }

    doPageLeave(timestamp: Date): PageViewEventProperties {
        return this._previousPageViewProperties(timestamp, this._currentPageview?.pageViewId)
    }

    doEvent(): PageViewEventProperties {
        return { $pageview_id: this._currentPageview?.pageViewId }
    }

    private _previousPageViewProperties(timestamp: Date, pageviewId: string | undefined): PageViewEventProperties {
        const previousPageView = this._currentPageview

        if (!previousPageView) {
            return { $pageview_id: pageviewId }
        }

        let properties: PageViewEventProperties = {
            $pageview_id: pageviewId,
            $prev_pageview_id: previousPageView.pageViewId,
        }

        const scrollContext = this._instance.scrollManager.getContext()

        if (scrollContext && !this._instance.config.disable_scroll_properties) {
            let { maxScrollHeight, lastScrollY, maxScrollY, maxContentHeight, lastContentY, maxContentY } =
                scrollContext

            if (
                !isUndefined(maxScrollHeight) &&
                !isUndefined(lastScrollY) &&
                !isUndefined(maxScrollY) &&
                !isUndefined(maxContentHeight) &&
                !isUndefined(lastContentY) &&
                !isUndefined(maxContentY)
            ) {
                // Use ceil, so that e.g. scrolling 999.5px of a 1000px page is considered 100% scrolled
                maxScrollHeight = Math.ceil(maxScrollHeight)
                lastScrollY = Math.ceil(lastScrollY)
                maxScrollY = Math.ceil(maxScrollY)
                maxContentHeight = Math.ceil(maxContentHeight)
                lastContentY = Math.ceil(lastContentY)
                maxContentY = Math.ceil(maxContentY)

                // if the maximum scroll height is near 0, then the percentage is 1
                const lastScrollPercentage =
                    maxScrollHeight <= 1 ? 1 : clampToRange(lastScrollY / maxScrollHeight, 0, 1, logger)
                const maxScrollPercentage =
                    maxScrollHeight <= 1 ? 1 : clampToRange(maxScrollY / maxScrollHeight, 0, 1, logger)
                const lastContentPercentage =
                    maxContentHeight <= 1 ? 1 : clampToRange(lastContentY / maxContentHeight, 0, 1, logger)
                const maxContentPercentage =
                    maxContentHeight <= 1 ? 1 : clampToRange(maxContentY / maxContentHeight, 0, 1, logger)

                properties = extend(properties, {
                    $prev_pageview_last_scroll: lastScrollY,
                    $prev_pageview_last_scroll_percentage: lastScrollPercentage,
                    $prev_pageview_max_scroll: maxScrollY,
                    $prev_pageview_max_scroll_percentage: maxScrollPercentage,
                    $prev_pageview_last_content: lastContentY,
                    $prev_pageview_last_content_percentage: lastContentPercentage,
                    $prev_pageview_max_content: maxContentY,
                    $prev_pageview_max_content_percentage: maxContentPercentage,
                })
            }
        }

        if (previousPageView.pathname) {
            properties.$prev_pageview_pathname = previousPageView.pathname
        }
        if (previousPageView.timestamp) {
            // Use seconds, for consistency with our other duration-related properties like $duration
            properties.$prev_pageview_duration = (timestamp.getTime() - previousPageView.timestamp.getTime()) / 1000
        }

        return properties
    }
}
