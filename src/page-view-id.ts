import { _UUID } from './utils'

export class PageViewIdManager {
    _pageViewId: string | undefined

    _seenFirstPageView = false

    constructor(private uuidFn: () => string) {}

    onPageview(): void {
        // As the first $pageview event may come after a different event,
        // we only reset the ID _after_ the second $pageview event.
        if (this._seenFirstPageView) {
            this._pageViewId = this.uuidFn()
        }
        this._seenFirstPageView = true
    }

    getPageViewId(): string {
        if (!this._pageViewId) {
            this._pageViewId = this.uuidFn()
        }

        return this._pageViewId
    }
}
