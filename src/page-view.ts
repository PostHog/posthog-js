import { uuidv7 } from './uuidv7'
import { window } from './utils'

interface PageViewData {
    pageViewId: string
    pathname?: string
    maxScroll?: number
    maxScrollPercentage?: number
    lastScrollNumber?: number
    lastScrollPercentage?: number
}

interface PageViewEventProperties {
    $pageview_id: string
    $prev_pageview_pageview_id: string | undefined
    $prev_pageview_pathname: string | undefined
    $prev_pageview_max_scroll: number | undefined
    $prev_pageview_max_scroll_percentage: number | undefined
    $prev_pageview_last_scroll_number: number | undefined
    $prev_pageview_last_scroll_percentage: number | undefined
}

interface PageLeaveEventProperties {
    $pageview_id: string
    $prev_pageview_pageview_id: string | undefined
    $prev_pageview_pathname: string | undefined
    $prev_pageview_max_scroll: number | undefined
    $prev_pageview_max_scroll_percentage: number | undefined
    $prev_pageview_last_scroll_number: number | undefined
    $prev_pageview_last_scroll_percentage: number | undefined
}

interface NonPageEventProperties {
    $pageview_id: string
}
export class PageViewManager {
    _pageViewData: PageViewData | undefined
    _hasSeenPageView = false

    _createPageViewData(): PageViewData {
        return {
            pageViewId: uuidv7(),
            pathname: window?.location.pathname,
        }
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

        return {
            $pageview_id: this._pageViewData.pageViewId,
            $prev_pageview_pageview_id: prevPageViewData?.pageViewId,
            $prev_pageview_last_scroll_number: prevPageViewData?.lastScrollNumber,
            $prev_pageview_last_scroll_percentage: prevPageViewData?.lastScrollPercentage,
            $prev_pageview_max_scroll: prevPageViewData?.maxScroll,
            $prev_pageview_max_scroll_percentage: prevPageViewData?.maxScrollPercentage,
            $prev_pageview_pathname: prevPageViewData?.pathname,
        }
    }

    doPageLeave(): PageLeaveEventProperties {
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
            $prev_pageview_last_scroll_number: prevPageViewData?.lastScrollNumber,
            $prev_pageview_last_scroll_percentage: prevPageViewData?.lastScrollPercentage,
            $prev_pageview_max_scroll: prevPageViewData?.maxScroll,
            $prev_pageview_max_scroll_percentage: prevPageViewData?.maxScrollPercentage,
            $prev_pageview_pathname: prevPageViewData?.pathname,
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
}
