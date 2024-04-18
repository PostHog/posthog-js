import { includes, registerEvent } from './utils'
import RageClick from './extensions/rageclick'
import { Properties } from './types'
import { PostHogCore } from './posthog-core'

import { document, window } from './utils/globals'
import { getParentElement, isTag } from './autocapture-utils'

type HeatmapEventBuffer =
    | {
          [key: string]: Properties[]
      }
    | undefined

function elementOrParentPositionMatches(el: Element, matches: string[], breakOnElement?: Element): boolean {
    let curEl: Element | false = el

    while (curEl && !isTag(curEl, 'body')) {
        if (curEl === breakOnElement) {
            return false
        }

        if (includes(matches, window?.getComputedStyle(curEl).position)) {
            return true
        }

        curEl = getParentElement(curEl)
    }

    return false
}

export class Heatmaps {
    rageclicks = new RageClick()
    _isDisabledServerSide: boolean | null = null
    _initialized = false
    _mouseMoveTimeout: number | undefined

    // TODO: Periodically flush this if no other event has taken care of it
    private buffer: HeatmapEventBuffer

    constructor(private instance: PostHogCore) {}

    public startIfEnabled(): void {
        if (this.isEnabled && !this._initialized) {
            this._setupListeners()
        }
    }

    public get isEnabled(): boolean {
        return !!this.instance.config.__preview_heatmaps
    }

    public getAndClearBuffer(): HeatmapEventBuffer {
        const buffer = this.buffer
        this.buffer = undefined
        return buffer
    }

    private _setupListeners(): void {
        if (!window || !document) {
            return
        }

        registerEvent(document, 'click', (e) => this._onClick((e || window?.event) as MouseEvent), false, true)
        registerEvent(document, 'mousemove', (e) => this._onMouseMove((e || window?.event) as MouseEvent), false, true)

        this._initialized = true
    }

    private _getProperties(e: MouseEvent, type: string): Properties {
        // We need to know if the target element is fixed or not
        // If fixed then we won't account for scrolling
        // If not then we will account for scrolling

        const scrollY = this.instance.scrollManager.scrollY()
        const scrollX = this.instance.scrollManager.scrollX()
        const scrollElement = this.instance.scrollManager.scrollElement()

        const isFixedOrSticky = elementOrParentPositionMatches(e.target as Element, ['fixed', 'sticky'], scrollElement)

        return {
            x: e.clientX + (isFixedOrSticky ? 0 : scrollX),
            y: e.clientY + (isFixedOrSticky ? 0 : scrollY),
            target_fixed: isFixedOrSticky,
            type,
        }
    }

    private _onClick(e: MouseEvent): void {
        const properties = this._getProperties(e, 'click')

        if (this.rageclicks?.isRageClick(e.clientX, e.clientY, new Date().getTime())) {
            this._capture({
                ...properties,
                type: 'rageclick',
            })
        }

        // TODO: Detect deadclicks

        this._capture(properties)
    }

    private _onMouseMove(e: Event): void {
        clearTimeout(this._mouseMoveTimeout)

        this._mouseMoveTimeout = setTimeout(() => {
            this._capture(this._getProperties(e as MouseEvent, 'mousemove'))
        }, 500)
    }

    private _capture(properties: Properties): void {
        if (!window) {
            return
        }
        const url = window.location.href

        this.buffer = this.buffer || {}

        if (!this.buffer[url]) {
            this.buffer[url] = []
        }

        this.buffer[url].push(properties)
    }
}
