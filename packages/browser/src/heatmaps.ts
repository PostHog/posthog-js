import RageClick from './extensions/rageclick'
import { DeadClickCandidate, Properties, RemoteConfig } from './types'
import { PostHog } from './posthog-core'

import { document, window } from './utils/globals'
import { getEventTarget, getParentElement } from './autocapture-utils'
import { HEATMAPS_ENABLED_SERVER_SIDE } from './constants'
import { isNumber, isUndefined, isEmptyObject, isObject } from '@posthog/core'
import { createLogger } from './utils/logger'
import { isElementInToolbar, isElementNode, isTag } from './utils/element-utils'
import { DeadClicksAutocapture, isDeadClicksEnabledForHeatmaps } from './extensions/dead-clicks-autocapture'
import { includes } from '@posthog/core'
import { addEventListener, extendArray } from './utils'
import { maskQueryParams } from './utils/request-utils'
import { PERSONAL_DATA_CAMPAIGN_PARAMS, MASKED } from './utils/event-utils'

const DEFAULT_FLUSH_INTERVAL = 5000

const logger = createLogger('[Heatmaps]')

type HeatmapEventBuffer =
    | {
          [key: string]: Properties[]
      }
    | undefined

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

export class Heatmaps {
    instance: PostHog
    rageclicks = new RageClick()
    _enabledServerSide: boolean = false
    _initialized = false
    _mouseMoveTimeout: ReturnType<typeof setTimeout> | undefined

    private _buffer: HeatmapEventBuffer
    private _flushInterval: ReturnType<typeof setInterval> | null = null
    private _deadClicksCapture: DeadClicksAutocapture | undefined
    private _onClickHandler: ((e: Event) => void) | undefined
    private _onMouseMoveHandler: ((e: Event) => void) | undefined
    private _flushHandler: (() => void) | undefined
    private _onVisibilityChange_handler: (() => void) | undefined

    constructor(instance: PostHog) {
        this.instance = instance
        this._enabledServerSide = !!this.instance.persistence?.props[HEATMAPS_ENABLED_SERVER_SIDE]
    }

    public get flushIntervalMilliseconds(): number {
        let flushInterval = DEFAULT_FLUSH_INTERVAL
        if (
            isObject(this.instance.config.capture_heatmaps) &&
            this.instance.config.capture_heatmaps.flush_interval_milliseconds
        ) {
            flushInterval = this.instance.config.capture_heatmaps.flush_interval_milliseconds
        }
        return flushInterval
    }

    public get isEnabled(): boolean {
        if (!isUndefined(this.instance.config.capture_heatmaps)) {
            return this.instance.config.capture_heatmaps !== false
        }
        if (!isUndefined(this.instance.config.enable_heatmaps)) {
            return this.instance.config.enable_heatmaps
        }
        return this._enabledServerSide
    }

    public startIfEnabled(): void {
        if (this.isEnabled) {
            // nested if here since we only want to run the else
            // if this.enabled === false
            // not if this method is called more than once
            if (this._initialized) {
                return
            }
            logger.info('starting...')
            this._setupListeners()
            this._onVisibilityChange()
        } else {
            clearInterval(this._flushInterval ?? undefined)
            this._removeListeners()
            this.getAndClearBuffer()
        }
    }

    public onRemoteConfig(response: RemoteConfig) {
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
        const buffer = this._buffer
        this._buffer = undefined
        return buffer
    }

    private _onDeadClick(click: DeadClickCandidate): void {
        this._onClick(click.originalEvent, 'deadclick')
    }

    private _onVisibilityChange(): void {
        // always clear the interval just in case
        if (this._flushInterval) {
            clearInterval(this._flushInterval)
        }

        this._flushInterval = shouldPoll(document)
            ? setInterval(this._flush.bind(this), this.flushIntervalMilliseconds)
            : null
    }

    private _setupListeners(): void {
        if (!window || !document) {
            return
        }

        this._flushHandler = this._flush.bind(this)
        addEventListener(window, 'beforeunload', this._flushHandler)

        this._onClickHandler = (e) => this._onClick((e || window?.event) as MouseEvent)
        addEventListener(document, 'click', this._onClickHandler, { capture: true })

        this._onMouseMoveHandler = (e) => this._onMouseMove((e || window?.event) as MouseEvent)
        addEventListener(document, 'mousemove', this._onMouseMoveHandler, { capture: true })

        this._deadClicksCapture = new DeadClicksAutocapture(
            this.instance,
            isDeadClicksEnabledForHeatmaps,
            this._onDeadClick.bind(this)
        )
        this._deadClicksCapture.startIfEnabled()

        this._onVisibilityChange_handler = this._onVisibilityChange.bind(this)
        addEventListener(document, 'visibilitychange', this._onVisibilityChange_handler)

        this._initialized = true
    }

    private _removeListeners(): void {
        if (!window || !document) {
            return
        }

        if (this._flushHandler) {
            window.removeEventListener('beforeunload', this._flushHandler)
        }

        if (this._onClickHandler) {
            document.removeEventListener('click', this._onClickHandler, { capture: true })
        }

        if (this._onMouseMoveHandler) {
            document.removeEventListener('mousemove', this._onMouseMoveHandler, { capture: true })
        }

        if (this._onVisibilityChange_handler) {
            document.removeEventListener('visibilitychange', this._onVisibilityChange_handler)
        }

        clearTimeout(this._mouseMoveTimeout)

        this._deadClicksCapture?.stop()

        this._initialized = false
    }

    private _getProperties(e: MouseEvent, type: string): Properties {
        // We need to know if the target element is fixed or not
        // If fixed then we won't account for scrolling
        // If not then we will account for scrolling

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

    private _onClick(e: MouseEvent, type: string = 'click'): void {
        if (isElementInToolbar(e.target) || !isValidMouseEvent(e)) {
            return
        }

        const properties = this._getProperties(e, type)

        if (this.rageclicks?.isRageClick(e.clientX, e.clientY, new Date().getTime())) {
            this._capture({
                ...properties,
                type: 'rageclick',
            })
        }

        this._capture(properties)
    }

    private _onMouseMove(e: Event): void {
        if (isElementInToolbar(e.target) || !isValidMouseEvent(e)) {
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

        const href = window.location.href

        // mask url query params
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
