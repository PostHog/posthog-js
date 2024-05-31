import { includes, registerEvent } from './utils'
import RageClick from './extensions/rageclick'
import { DecideResponse, Properties } from './types'
import { PostHog } from './posthog-core'

import { document, window } from './utils/globals'
import { getParentElement, isTag } from './autocapture-utils'
import { HEATMAPS_ENABLED_SERVER_SIDE, TOOLBAR_ID } from './constants'
import { PassengerEvents } from './extensions/passenger-events'

type HeatmapEventBuffer = {
    [key: string]: Properties[]
}

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

function elementInToolbar(el: Element): boolean {
    // NOTE: .closest is not supported in IE11 hence the operator check
    return el.id === TOOLBAR_ID || !!el.closest?.('#' + TOOLBAR_ID)
}

export class Heatmaps extends PassengerEvents<HeatmapEventBuffer> {
    rageclicks = new RageClick()
    _mouseMoveTimeout: number | undefined

    constructor(instance: PostHog) {
        super(instance, 'heatmaps', (x) => x.config.enable_heatmaps, HEATMAPS_ENABLED_SERVER_SIDE)
    }

    protected onStart(): void {
        this._setupListeners()
    }

    public afterDecideResponse(response: DecideResponse) {
        const optIn = !!response['heatmaps']

        if (this.instance.persistence) {
            this.instance.persistence.register({
                [HEATMAPS_ENABLED_SERVER_SIDE]: optIn,
            })
        }
        // store this in-memory in case persistence is disabled
        this._enabledServerSide = optIn
        this.startIfEnabled()
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
        if (elementInToolbar(e.target as Element)) {
            return
        }
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
        if (elementInToolbar(e.target as Element)) {
            return
        }
        clearTimeout(this._mouseMoveTimeout)

        this._mouseMoveTimeout = setTimeout(() => {
            this._capture(this._getProperties(e as MouseEvent, 'mousemove'))
        }, 500)
    }

    private _capture(properties: Properties): void {
        if (!window) {
            return
        }

        // TODO we should be able to mask this
        const url = window.location.href

        this.buffer = this.buffer || {}

        if (!this.buffer[url]) {
            this.buffer[url] = []
        }

        this.buffer[url].push(properties)
    }
}
