import { uuidv7 } from './uuidv7'

export class PageViewIdManager {
    _pageViewId: string | undefined

    _seenFirstPageView = false

    onPageview(): void {
        // As the first $pageview event may come after a different event,
        // we only reset the ID _after_ the second $pageview event.
        if (this._seenFirstPageView) {
            this._pageViewId = uuidv7()
        }
        this._seenFirstPageView = true
    }

    getPageViewId(): string {
        if (!this._pageViewId) {
            this._pageViewId = uuidv7()
        }

        return this._pageViewId
    }
}
