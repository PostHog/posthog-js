import { _UUID } from './utils'

export class PageViewIdManager {
    _pageViewId: string = _UUID()
    _seenFirstPageView = false

    onPageview(): void {
        // As the first $pageview event may come after a different event,
        // we only reset the ID _after_ the second $pageview event.
        if (this._seenFirstPageView) {
            this._pageViewId = _UUID()
        }
        this._seenFirstPageView = true
    }

    getPageViewId(): string {
        return this._pageViewId
    }
}
