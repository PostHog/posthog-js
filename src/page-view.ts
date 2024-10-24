import { window } from './utils/globals'
import { PostHog } from './posthog-core'
import { isUndefined } from './utils/type-utils'
import { clampToRange } from './utils/number-utils'

interface PageViewEventProperties {
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

export class PageViewManager {
    _currentPath?: string
    _prevPageviewTimestamp?: Date
    _instance: PostHog

    constructor(instance: PostHog) {
        this._instance = instance
    }

    doPageView(timestamp: Date): PageViewEventProperties {
        const response = this._previousPageViewProperties(timestamp)

        // On a pageview we reset the contexts
        this._currentPath = window?.location.pathname ?? ''
        this._instance.scrollManager.resetContext()
        this._prevPageviewTimestamp = timestamp

        return response
    }

    doPageLeave(timestamp: Date): PageViewEventProperties {
        return this._previousPageViewProperties(timestamp)
    }

    private _previousPageViewProperties(timestamp: Date): PageViewEventProperties {
        const previousPath = this._currentPath
        const previousTimestamp = this._prevPageviewTimestamp
        const scrollContext = this._instance.scrollManager.getContext()

        if (!previousTimestamp) {
            // this means there was no previous pageview
            return {}
        }

        let properties: PageViewEventProperties = {}
        if (scrollContext) {
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
                    maxScrollHeight <= 1 ? 1 : clampToRange(lastScrollY / maxScrollHeight, 0, 1)
                const maxScrollPercentage = maxScrollHeight <= 1 ? 1 : clampToRange(maxScrollY / maxScrollHeight, 0, 1)
                const lastContentPercentage =
                    maxContentHeight <= 1 ? 1 : clampToRange(lastContentY / maxContentHeight, 0, 1)
                const maxContentPercentage =
                    maxContentHeight <= 1 ? 1 : clampToRange(maxContentY / maxContentHeight, 0, 1)

                properties = {
                    $prev_pageview_last_scroll: lastScrollY,
                    $prev_pageview_last_scroll_percentage: lastScrollPercentage,
                    $prev_pageview_max_scroll: maxScrollY,
                    $prev_pageview_max_scroll_percentage: maxScrollPercentage,
                    $prev_pageview_last_content: lastContentY,
                    $prev_pageview_last_content_percentage: lastContentPercentage,
                    $prev_pageview_max_content: maxContentY,
                    $prev_pageview_max_content_percentage: maxContentPercentage,
                }
            }
        }

        if (previousPath) {
            properties.$prev_pageview_pathname = previousPath
        }
        if (previousTimestamp) {
            // Use seconds, for consistency with our other duration-related properties like $duration
            properties.$prev_pageview_duration = (timestamp.getTime() - previousTimestamp.getTime()) / 1000
        }

        return properties
    }
}
