import { window } from './utils/globals'
import { PostHog } from './posthog-core'
import { isArray } from './utils/type-utils'

export interface ScrollContext {
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

// This class is responsible for tracking scroll events and maintaining the scroll context
export class ScrollManager {
    private context: ScrollContext | undefined

    constructor(private instance: PostHog) {}

    getContext(): ScrollContext | undefined {
        return this.context
    }

    resetContext(): ScrollContext | undefined {
        const ctx = this.context

        // update the scroll properties for the new page, but wait until the next tick
        // of the event loop
        setTimeout(this._updateScrollData, 0)

        return ctx
    }

    private _updateScrollData = () => {
        if (!this.context) {
            this.context = {}
        }

        const el = this.scrollElement()

        const scrollY = this.scrollY()
        const scrollHeight = el ? Math.max(0, el.scrollHeight - el.clientHeight) : 0
        const contentY = scrollY + (el?.clientHeight || 0)
        const contentHeight = el?.scrollHeight || 0

        this.context.lastScrollY = Math.ceil(scrollY)
        this.context.maxScrollY = Math.max(scrollY, this.context.maxScrollY ?? 0)
        this.context.maxScrollHeight = Math.max(scrollHeight, this.context.maxScrollHeight ?? 0)

        this.context.lastContentY = contentY
        this.context.maxContentY = Math.max(contentY, this.context.maxContentY ?? 0)
        this.context.maxContentHeight = Math.max(contentHeight, this.context.maxContentHeight ?? 0)
    }

    startMeasuringScrollPosition() {
        // setting the third argument to `true` means that we will receive scroll events for other scrollable elements
        // on the page, not just the window
        // see https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener#usecapture
        window?.addEventListener('scroll', this._updateScrollData, true)
        window?.addEventListener('scrollend', this._updateScrollData, true)
        window?.addEventListener('resize', this._updateScrollData)
    }

    public scrollElement(): Element | undefined {
        if (this.instance.config.scroll_root_selector) {
            const selectors = isArray(this.instance.config.scroll_root_selector)
                ? this.instance.config.scroll_root_selector
                : [this.instance.config.scroll_root_selector]
            for (const selector of selectors) {
                const element = window?.document.querySelector(selector)
                if (element) {
                    return element
                }
            }
            return undefined
        } else {
            return window?.document.documentElement
        }
    }

    public scrollY(): number {
        if (this.instance.config.scroll_root_selector) {
            const element = this.scrollElement()
            return (element && element.scrollTop) || 0
        } else {
            return window ? window.scrollY || window.pageYOffset || window.document.documentElement.scrollTop || 0 : 0
        }
    }

    public scrollX(): number {
        if (this.instance.config.scroll_root_selector) {
            const element = this.scrollElement()
            return (element && element.scrollLeft) || 0
        } else {
            return window ? window.scrollX || window.pageXOffset || window.document.documentElement.scrollLeft || 0 : 0
        }
    }
}
