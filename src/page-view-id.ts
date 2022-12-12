import { _UUID } from './utils'

export class PageViewIdManager {
    _pageViewId: string | null

    constructor() {
        this._pageViewId = null
    }

    _setPageViewId(pageViewId: string | null): void {
        this._pageViewId = pageViewId
    }

    resetPageViewId(): void {
        this._setPageViewId(_UUID())
    }

    getPageViewId(): string {
        if (this._pageViewId === null) {
            this.resetPageViewId()
        }
        return <string>this._pageViewId
    }
}
