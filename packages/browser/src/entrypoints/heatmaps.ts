import RageClick from '../extensions/rageclick'
import { DeadClickCandidate, Properties } from '../types'
import { PostHog } from '../posthog-core'

import { assignableWindow, document, window } from '../utils/globals'
import { isNumber, isEmptyObject, isObject } from '@posthog/core'
import { createLogger } from '../utils/logger'
import { isElementInToolbar, isElementNode, isTag } from '../utils/element-utils'
import { DeadClicksAutocapture, isDeadClicksEnabledForHeatmaps } from '../extensions/dead-clicks-autocapture'
import { includes } from '@posthog/core'
import { addEventListener, extendArray } from '../utils'
import { maskQueryParams } from '../utils/request-utils'
import { PERSONAL_DATA_CAMPAIGN_PARAMS, MASKED } from '../utils/event-utils'
import { getEventTarget, getParentElement } from '../utils/dom-event-utils'
import { HeatmapEventBuffer } from '../extensions/heatmaps'

const DEFAULT_FLUSH_INTERVAL = 5000

const logger = createLogger('[Heatmaps]')

function elementOrParentPositionMatches(el: Element | null, matches: string[], breakOnElement?: Element): boolean {
    let curEl: Element | null | false = el

    while (curEl && isElementNode(curEl) && !isTag(curEl, 'body')) {
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

function isValidMouseEvent(e: unknown): e is MouseEvent {
    return isObject(e) && 'clientX' in e && 'clientY' in e && isNumber(e.clientX) && isNumber(e.clientY)
}

function shouldPoll(document: Document | undefined): boolean {
    return document?.visibilityState === 'visible'
}

class LazyLoadedHeatmaps {
    instance: PostHog
    rageclicks: RageClick
    _mouseMoveTimeout: ReturnType<typeof setTimeout> | undefined

    private _buffer: HeatmapEventBuffer
    private _flushInterval: ReturnType<typeof setInterval> | null = null
    private _deadClicksCapture: DeadClicksAutocapture | undefined
    private _flushHandler: (() => void) | undefined
    private _onVisibilityChange_handler: (() => void) | undefined

    constructor(instance: PostHog) {
        this.instance = instance
        this.rageclicks = new RageClick(instance.config.rageclick)
    }

    private get _flushIntervalMilliseconds(): number {
        let flushInterval = DEFAULT_FLUSH_INTERVAL
        if (
            isObject(this.instance.config.capture_heatmaps) &&
            this.instance.config.capture_heatmaps.flush_interval_milliseconds
        ) {
            flushInterval = this.instance.config.capture_heatmaps.flush_interval_milliseconds
        }
        return flushInterval
    }

    start(): void {
        if (!window || !document) {
            return
        }

        this._flushHandler = this._flush.bind(this)
        addEventListener(window, 'beforeunload', this._flushHandler)

        this._deadClicksCapture = new DeadClicksAutocapture(
            this.instance,
            isDeadClicksEnabledForHeatmaps,
            this._onDeadClick.bind(this)
        )
        this._deadClicksCapture.startIfEnabled()

        this._onVisibilityChange_handler = this._onVisibilityChange.bind(this)
        addEventListener(document, 'visibilitychange', this._onVisibilityChange_handler)

        this._onVisibilityChange()

        logger.info('started lazy impl')
    }

    stop(): void {
        if (!window || !document) {
            return
        }

        if (this._flushHandler) {
            window.removeEventListener('beforeunload', this._flushHandler)
        }

        if (this._onVisibilityChange_handler) {
            document.removeEventListener('visibilitychange', this._onVisibilityChange_handler)
        }

        clearTimeout(this._mouseMoveTimeout)
        clearInterval(this._flushInterval ?? undefined)

        this._deadClicksCapture?.stop()

        this.getAndClearBuffer()
    }

    getAndClearBuffer(): HeatmapEventBuffer {
        const buffer = this._buffer
        this._buffer = undefined
        return buffer
    }

    _onClick(e: MouseEvent, type: string = 'click'): void {
        if (isElementInToolbar(e.target) || !isValidMouseEvent(e)) {
            return
        }

        const properties = this._getProperties(e, type)

        if (type === 'click' && this.rageclicks?.isRageClick(e.clientX, e.clientY, new Date().getTime())) {
            this._capture({
                ...properties,
                type: 'rageclick',
            })
        }

        if (type === 'mousemove') {
            clearTimeout(this._mouseMoveTimeout)
            this._mouseMoveTimeout = setTimeout(() => {
                this._capture(properties)
            }, 500)
        } else {
            this._capture(properties)
        }
    }

    private _onDeadClick(click: DeadClickCandidate): void {
        this._onClick(click.originalEvent, 'deadclick')
    }

    private _onVisibilityChange(): void {
        if (this._flushInterval) {
            clearInterval(this._flushInterval)
        }

        this._flushInterval = shouldPoll(document)
            ? setInterval(this._flush.bind(this), this._flushIntervalMilliseconds)
            : null
    }

    private _getProperties(e: MouseEvent, type: string): Properties {
        const scrollY = this.instance.scrollManager.scrollY()
        const scrollX = this.instance.scrollManager.scrollX()
        const scrollElement = this.instance.scrollManager.scrollElement()

        const isFixedOrSticky = elementOrParentPositionMatches(getEventTarget(e), ['fixed', 'sticky'], scrollElement)

        return {
            x: e.clientX + (isFixedOrSticky ? 0 : scrollX),
            y: e.clientY + (isFixedOrSticky ? 0 : scrollY),
            target_fixed: isFixedOrSticky,
            type,
        }
    }

    private _capture(properties: Properties): void {
        if (!window) {
            return
        }

        const href = window.location.href

        const maskPersonalDataProperties = this.instance.config.mask_personal_data_properties
        const customPersonalDataProperties = this.instance.config.custom_personal_data_properties

        const paramsToMask = maskPersonalDataProperties
            ? extendArray([], PERSONAL_DATA_CAMPAIGN_PARAMS, customPersonalDataProperties || [])
            : []

        const url = maskQueryParams(href, paramsToMask, MASKED)

        this._buffer = this._buffer || {}

        if (!this._buffer[url]) {
            this._buffer[url] = []
        }

        this._buffer[url].push(properties)
    }

    private _flush(): void {
        if (!this._buffer || isEmptyObject(this._buffer)) {
            return
        }

        this.instance.capture('$$heatmap', {
            $heatmap_data: this.getAndClearBuffer(),
        })
    }
}

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.initHeatmaps = (ph: PostHog) => {
    return new LazyLoadedHeatmaps(ph)
}
