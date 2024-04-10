import { window } from './utils/globals'
import { PostHog } from './posthog-core'
import { _isUndefined } from './utils/type-utils'

interface PageViewEventProperties {
    $prev_pageview_pathname?: string
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
    _instance: PostHog

    constructor(instance: PostHog) {
        this._instance = instance
    }

    doPageView(): PageViewEventProperties {
        const response = this._previousScrollProperties()

        // On a pageview we reset the contexts
        this._currentPath = window?.location.pathname ?? ''
        this._instance.scrollManager.resetContext()

        return response
    }

    doPageLeave(): PageViewEventProperties {
        return this._previousScrollProperties()
    }

    private _previousScrollProperties(): PageViewEventProperties {
        const previousPath = this._currentPath
        const scrollContext = this._instance.scrollManager.getContext()

        if (!previousPath || !scrollContext) {
            return {}
        }

        let { maxScrollHeight, lastScrollY, maxScrollY, maxContentHeight, lastContentY, maxContentY } = scrollContext

        if (
            _isUndefined(maxScrollHeight) ||
            _isUndefined(lastScrollY) ||
            _isUndefined(maxScrollY) ||
            _isUndefined(maxContentHeight) ||
            _isUndefined(lastContentY) ||
            _isUndefined(maxContentY)
        ) {
            return {}
        }

        // Use ceil, so that e.g. scrolling 999.5px of a 1000px page is considered 100% scrolled
        maxScrollHeight = Math.ceil(maxScrollHeight)
        lastScrollY = Math.ceil(lastScrollY)
        maxScrollY = Math.ceil(maxScrollY)
        maxContentHeight = Math.ceil(maxContentHeight)
        lastContentY = Math.ceil(lastContentY)
        maxContentY = Math.ceil(maxContentY)

        // if the maximum scroll height is near 0, then the percentage is 1
        const lastScrollPercentage = maxScrollHeight <= 1 ? 1 : clamp(lastScrollY / maxScrollHeight, 0, 1)
        const maxScrollPercentage = maxScrollHeight <= 1 ? 1 : clamp(maxScrollY / maxScrollHeight, 0, 1)
        const lastContentPercentage = maxContentHeight <= 1 ? 1 : clamp(lastContentY / maxContentHeight, 0, 1)
        const maxContentPercentage = maxContentHeight <= 1 ? 1 : clamp(maxContentY / maxContentHeight, 0, 1)

        return {
            $prev_pageview_pathname: previousPath,
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

function clamp(x: number, min: number, max: number) {
    return Math.max(min, Math.min(x, max))
}
