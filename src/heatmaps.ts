import { _include, _includes, _register_event } from './utils'
import RageClick from './extensions/rageclick'
import { Properties } from './types'
import { PostHog } from './posthog-core'

import { document, window } from './utils/globals'
import { getParentElement, isTag } from './autocapture-utils'

function elementOrParentPositionMatches(el: Element, matches: string[], breakOnElement?: Element): boolean {
    let curEl: Element | false = el

    while (curEl && !isTag(curEl, 'body')) {
        if (curEl === breakOnElement) {
            return false
        }

        if (_includes(matches, window?.getComputedStyle(curEl).position)) {
            return true
        }

        curEl = getParentElement(curEl)
    }

    return false
}

export class Heatmaps {
    instance: PostHog
    rageclicks = new RageClick()
    _isDisabledServerSide: boolean | null = null
    _initialized = false
    _mouseMoveTimeout: number | undefined

    constructor(instance: PostHog) {
        this.instance = instance

        if (this.isEnabled) {
            this._setupListeners()
        }
    }

    public get isEnabled(): boolean {
        return !!this.instance.config.__preview_heatmaps
    }

    private _setupListeners(): void {
        if (!window || !document) {
            return
        }

        _register_event(document, 'click', (e) => this._onClick((e || window?.event) as MouseEvent), false, true)
        _register_event(
            document,
            'mousemove',
            (e) => this._onMouseMove((e || window?.event) as MouseEvent),
            false,
            true
        )
    }

    private _getProperties(e: MouseEvent): Properties {
        // We need to know if the target element is fixed or not
        // If fixed then we won't account for scrolling
        // If not then we will account for scrolling

        const scrollY = this.instance.scrollManager.scrollY()
        const scrollX = this.instance.scrollManager.scrollX()
        const scrollElement = this.instance.scrollManager.scrollElement()

        const isFixedOrSticky = elementOrParentPositionMatches(e.target as Element, ['fixed', 'sticky'], scrollElement)

        return {
            $pointer_x: e.clientX + (isFixedOrSticky ? 0 : scrollX),
            $pointer_y: e.clientY + (isFixedOrSticky ? 0 : scrollY),
            $pointer_target_fixed: isFixedOrSticky,
        }
    }

    private _onClick(e: MouseEvent): void {
        const properties = this._getProperties(e)

        if (this.rageclicks?.isRageClick(e.clientX, e.clientY, new Date().getTime())) {
            this._capture({
                ...properties,
                $heatmap_event: 'rageclick',
            })
        }

        // TODO: Detect deadclicks

        this._capture({
            ...properties,
            $heatmap_event: 'click',
        })
    }

    private _onMouseMove(e: Event): void {
        clearTimeout(this._mouseMoveTimeout)

        this._mouseMoveTimeout = setTimeout(() => {
            const properties = this._getProperties(e as MouseEvent)
            this._capture({
                ...properties,
                $heatmap_event: 'mousemove',
            })
        }, 1000)
    }

    private _capture(properties: Properties): void {
        this.instance.capture('$heatmap', properties, {
            _batchKey: 'heatmaps',
        })
    }
}
