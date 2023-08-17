import { uuidv7 } from './uuidv7'
import * as utils from './utils'

interface PageViewData {
    pageViewId: string
    pathname?: string

    // scroll is how far down the page the user has scrolled,
    // content is how far down the page the user can view content
    // (e.g. if the page is 1000 tall, but the user's screen is only 500 tall,
    // and they don't scroll at all, then scroll is 0 and content is 500)
    maxScrollHeight?: number
    maxScrollY?: number
    lastScrollY?: number
    maxContentHeight?: number
    maxContentY?: number
    lastContentY?: number
}

interface ScrollProperties {
    $prev_pageview_last_scroll?: number
    $prev_pageview_last_scroll_percentage?: number
    $prev_pageview_max_scroll?: number
    $prev_pageview_max_scroll_percentage?: number
    $prev_pageview_last_content?: number
    $prev_pageview_last_content_percentage?: number
    $prev_pageview_max_content?: number
    $prev_pageview_max_content_percentage?: number
}

interface PageViewEventProperties extends ScrollProperties {
    $pageview_id: string
    $prev_pageview_pageview_id: string | undefined
    $prev_pageview_pathname: string | undefined
}

interface NonPageEventProperties {
    $pageview_id: string
}
export class PageViewManager {
    _pageViewData: PageViewData | undefined
    _hasSeenPageView = false

    _createPageViewData(): PageViewData {
        const data = {
            pageViewId: uuidv7(),
            pathname: utils.window?.location.pathname,
        }
        return data
    }

    doPageView(): PageViewEventProperties {
        let prevPageViewData: PageViewData | undefined
        // if there were events created before the first PageView, we would have created a
        // pageViewData for them. If this happened, we don't want to create a new pageViewData
        if (!this._hasSeenPageView) {
            this._hasSeenPageView = true
            prevPageViewData = undefined
            if (!this._pageViewData) {
                this._pageViewData = this._createPageViewData()
            }
        } else {
            prevPageViewData = this._pageViewData
            this._pageViewData = this._createPageViewData()
        }

        // update the scroll properties for the new page, but wait until the next tick
        // of the event loop
        setTimeout(this._updateScrollData, 0)

        return {
            $pageview_id: this._pageViewData.pageViewId,
            $prev_pageview_pageview_id: prevPageViewData?.pageViewId,
            $prev_pageview_pathname: prevPageViewData?.pathname,
            ...this._calculatePrevPageScrollProperties(prevPageViewData),
        }
    }

    doPageLeave(): PageViewEventProperties {
        const prevPageViewData = this._pageViewData
        if (!this._pageViewData) {
            this._pageViewData = this._createPageViewData()
        }
        const pageViewData = this._pageViewData

        // prevPageViewData and pageViewData should be the same here, it's unlikely that
        // this._pageViewData was undefined, but in case something weird happened, don't
        // send wrong data, just leave those fields undefined

        return {
            $pageview_id: pageViewData.pageViewId,
            $prev_pageview_pageview_id: prevPageViewData?.pageViewId,
            $prev_pageview_pathname: prevPageViewData?.pathname,
            ...this._calculatePrevPageScrollProperties(prevPageViewData),
        }
    }

    getNonPageEvent(): NonPageEventProperties {
        if (!this._pageViewData) {
            this._pageViewData = this._createPageViewData()
        }
        return {
            $pageview_id: this._pageViewData.pageViewId,
        }
    }

    _calculatePrevPageScrollProperties(prevPageViewData: PageViewData | undefined): ScrollProperties {
        if (
            !prevPageViewData ||
            prevPageViewData.maxScrollHeight == null ||
            prevPageViewData.lastScrollY == null ||
            prevPageViewData.maxScrollY == null ||
            prevPageViewData.maxContentHeight == null ||
            prevPageViewData.lastContentY == null ||
            prevPageViewData.maxContentY == null
        ) {
            return {}
        }

        let { maxScrollHeight, lastScrollY, maxScrollY, maxContentHeight, lastContentY, maxContentY } = prevPageViewData

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

    _updateScrollData = () => {
        if (!this._pageViewData) {
            this._pageViewData = this._createPageViewData()
        }
        const pageViewData = this._pageViewData

        const scrollY = this._scrollY()
        const scrollHeight = this._scrollHeight()
        const contentY = this._contentY()
        const contentHeight = this._contentHeight()

        pageViewData.lastScrollY = scrollY
        pageViewData.maxScrollY = Math.max(scrollY, pageViewData.maxScrollY ?? 0)
        pageViewData.maxScrollHeight = Math.max(scrollHeight, pageViewData.maxScrollHeight ?? 0)

        pageViewData.lastContentY = contentY
        pageViewData.maxContentY = Math.max(contentY, pageViewData.maxContentY ?? 0)
        pageViewData.maxContentHeight = Math.max(contentHeight, pageViewData.maxContentHeight ?? 0)
    }

    startMeasuringScrollPosition() {
        utils.window.addEventListener('scroll', this._updateScrollData)
        utils.window.addEventListener('scrollend', this._updateScrollData)
        utils.window.addEventListener('resize', this._updateScrollData)
    }

    stopMeasuringScrollPosition() {
        utils.window.removeEventListener('scroll', this._updateScrollData)
        utils.window.removeEventListener('scrollend', this._updateScrollData)
        utils.window.removeEventListener('resize', this._updateScrollData)
    }

    _scrollHeight(): number {
        return Math.max(
            0,
            utils.window.document.documentElement.scrollHeight - utils.window.document.documentElement.clientHeight
        )
    }

    _scrollY(): number {
        return utils.window.scrollY || utils.window.pageYOffset || utils.window.document.documentElement.scrollTop || 0
    }

    _contentHeight(): number {
        return utils.window.document.documentElement.scrollHeight || 0
    }

    _contentY(): number {
        const clientHeight = utils.window.document.documentElement.clientHeight || 0
        return this._scrollY() + clientHeight
    }
}

function clamp(x: number, min: number, max: number) {
    return Math.max(min, Math.min(x, max))
}
