import { includes, registerEvent } from './utils'
import RageClick from './extensions/rageclick'
import { DecideResponse, Properties } from './types'
import { PostHog } from './posthog-core'

import { document, window } from './utils/globals'
import { getParentElement, isTag } from './autocapture-utils'
import { HEATMAPS_ENABLED_SERVER_SIDE } from './constants'

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

const TOOLBAR_ID = '__POSTHOG_TOOLBAR__'

function elementInToolbar(el: Element): boolean {
    // NOTE: .closest is not supported in IE11 hence the operator check
    return el.id === TOOLBAR_ID || !!el.closest?.('#' + TOOLBAR_ID)
}

export class Heatmaps {
    instance: PostHog
    rageclicks = new RageClick()
    _enabledServerSide: boolean = false
    _initialized = false
    _mouseMoveTimeout: number | undefined

    // TODO: Periodically flush this if no other event has taken care of it
    private buffer: HeatmapEventBuffer

    constructor(instance: PostHog) {
        this.instance = instance
    }

    public startIfEnabled(): void {
        if (this.isEnabled && !this._initialized) {
            this._setupListeners()
        }
    }

    public get isEnabled(): boolean {
        return (
            !!this.instance.config.__preview_heatmaps ||
            !!this._enabledServerSide ||
            !!this.instance.persistence?.props[HEATMAPS_ENABLED_SERVER_SIDE]
        )
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
        const url = window.location.href

        this.buffer = this.buffer || {}

        if (!this.buffer[url]) {
            this.buffer[url] = []
        }

        this.buffer[url].push(properties)
    }
}
