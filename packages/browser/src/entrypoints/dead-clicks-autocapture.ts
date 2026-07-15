import { assignableWindow, document, LazyLoadedDeadClicksAutocaptureInterface } from '../utils/globals'
import { PostHog } from '../posthog-core'
import { isNull, isNumber, isUndefined } from '@posthog/core'
import { getEventTarget, shouldCaptureDeadClick, shouldSkipDeadClick } from '../autocapture-utils'
import { DeadClickCandidate, DeadClicksAutoCaptureConfig, Properties } from '../types'
import { autocapturePropertiesForElement } from '../autocapture'
import { isElementInToolbar, isElementNode, isTag } from '../utils/element-utils'
import { getNativeMutationObserverImplementation } from '../utils/prototype-utils'
import { addEventListener } from '../utils'

function asCandidate(event: MouseEvent | TouchEvent, extra: Partial<DeadClickCandidate>): DeadClickCandidate | null {
    const eventTarget = getEventTarget(event)
    if (eventTarget) {
        return {
            node: eventTarget,
            originalEvent: event,
            timestamp: Date.now(),
            ...extra,
        }
    }
    return null
}

function swipeDirection(dx: number, dy: number): 'left' | 'right' | 'up' | 'down' {
    if (Math.abs(dx) >= Math.abs(dy)) {
        return dx >= 0 ? 'right' : 'left'
    }
    return dy >= 0 ? 'down' : 'up'
}

// the event name doubles as the property prefix ($dead_click_* / $dead_swipe_*)
function deadEventName(candidate: DeadClickCandidate): '$dead_click' | '$dead_swipe' {
    return candidate.type === 'swipe' ? '$dead_swipe' : '$dead_click'
}

function hasModifierKey(event: MouseEvent | TouchEvent): boolean {
    return event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
}

function checkTimeout(value: number | undefined, thresholdMs: number) {
    return isNumber(value) && value >= thresholdMs
}

class LazyLoadedDeadClicksAutocapture implements LazyLoadedDeadClicksAutocaptureInterface {
    private _mutationObserver: MutationObserver | undefined
    private _lastMutation: number | undefined
    private _lastSelectionChanged: number | undefined
    private _lastVisibilityChange: number | undefined
    private _clicks: DeadClickCandidate[] = []
    private _checkClickTimer: number | undefined
    private _touchStart: { x: number; y: number; timestamp: number; scrollDelayMs?: number } | undefined
    // swipes are only observed on the default autocapture path, not when an external
    // consumer (e.g. heatmaps) provides its own capture handler
    private _observeSwipes: boolean
    private _config: Required<Omit<DeadClicksAutoCaptureConfig, 'css_selector_ignorelist'>> &
        Pick<DeadClicksAutoCaptureConfig, 'css_selector_ignorelist'>
    private _onCapture: (click: DeadClickCandidate, properties: Properties) => void

    private _defaultConfig = (defaultOnCapture: (click: DeadClickCandidate, properties: Properties) => void) => ({
        element_attribute_ignorelist: [],
        scroll_threshold_ms: 100,
        selection_change_threshold_ms: 100,
        mutation_threshold_ms: 2500,
        capture_clicks_with_modifier_keys: false,
        capture_dead_swipes: true,
        swipe_threshold_px: 30,
        __onCapture: defaultOnCapture,
    })

    private _asRequiredConfig(
        providedConfig?: DeadClicksAutoCaptureConfig
    ): Required<Omit<DeadClicksAutoCaptureConfig, 'css_selector_ignorelist'>> &
        Pick<DeadClicksAutoCaptureConfig, 'css_selector_ignorelist'> {
        const defaultConfig = this._defaultConfig(providedConfig?.__onCapture || this._captureDeadClick.bind(this))
        return {
            element_attribute_ignorelist:
                providedConfig?.element_attribute_ignorelist ?? defaultConfig.element_attribute_ignorelist,
            scroll_threshold_ms: providedConfig?.scroll_threshold_ms ?? defaultConfig.scroll_threshold_ms,
            selection_change_threshold_ms:
                providedConfig?.selection_change_threshold_ms ?? defaultConfig.selection_change_threshold_ms,
            mutation_threshold_ms: providedConfig?.mutation_threshold_ms ?? defaultConfig.mutation_threshold_ms,
            capture_clicks_with_modifier_keys:
                providedConfig?.capture_clicks_with_modifier_keys ?? defaultConfig.capture_clicks_with_modifier_keys,
            capture_dead_swipes: providedConfig?.capture_dead_swipes ?? defaultConfig.capture_dead_swipes,
            swipe_threshold_px: providedConfig?.swipe_threshold_px ?? defaultConfig.swipe_threshold_px,
            css_selector_ignorelist: providedConfig?.css_selector_ignorelist,
            __onCapture: defaultConfig.__onCapture,
        }
    }

    constructor(
        readonly instance: PostHog,
        config?: DeadClicksAutoCaptureConfig
    ) {
        this._config = this._asRequiredConfig(config)
        this._onCapture = this._config.__onCapture
        // when a consumer supplies its own capture handler (heatmaps) we only track clicks
        this._observeSwipes = this._config.capture_dead_swipes && isUndefined(config?.__onCapture)
    }

    start(observerTarget: Node) {
        this._startClickObserver()
        this._startScrollObserver()
        this._startSelectionChangedObserver()
        this._startVisibilityChangeObserver()
        this._startMutationObserver(observerTarget)
        if (this._observeSwipes) {
            this._startSwipeObserver()
        }
    }

    private _startMutationObserver(observerTarget: Node) {
        if (!this._mutationObserver) {
            const NativeMutationObserver = getNativeMutationObserverImplementation(assignableWindow)
            this._mutationObserver = new NativeMutationObserver((mutations) => {
                this._onMutation(mutations)
            })
            this._mutationObserver.observe(observerTarget, {
                attributes: true,
                characterData: true,
                childList: true,
                subtree: true,
            })
        }
    }

    stop() {
        this._mutationObserver?.disconnect()
        this._mutationObserver = undefined
        assignableWindow.removeEventListener('click', this._onClick)
        assignableWindow.removeEventListener('scroll', this._onScroll, { capture: true })
        assignableWindow.removeEventListener('selectionchange', this._onSelectionChange)
        assignableWindow.removeEventListener('touchstart', this._onTouchStart, { capture: true })
        assignableWindow.removeEventListener('touchend', this._onTouchEnd, { capture: true })
        assignableWindow.removeEventListener('touchcancel', this._onTouchCancel, { capture: true })
        document?.removeEventListener('visibilitychange', this._onVisibilityChange)
        // so a gesture in flight when we stopped can't pair with a touchend after a restart
        this._touchStart = undefined
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private _onMutation(_mutations: MutationRecord[]): void {
        // we don't actually care about the content of the mutations, right now
        this._lastMutation = Date.now()
    }

    private _startClickObserver() {
        addEventListener(assignableWindow, 'click', this._onClick)
    }

    private _onClick = (event: Event): void => {
        const click = asCandidate(event as MouseEvent, { type: 'click' })
        if (!isNull(click) && !this._ignore(click)) {
            this._clicks.push(click)
        }
        this._scheduleCheck()
    }

    private _scheduleCheck() {
        if (this._clicks.length && isUndefined(this._checkClickTimer)) {
            this._checkClickTimer = assignableWindow.setTimeout(() => {
                this._checkClicks()
            }, 1000)
        }
    }

    // `capture: true` is required to get scroll events for other scrollable elements
    // on the page, not just the window
    // see https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener#usecapture
    //
    // `passive: true` is used to tell the browser that the scroll event handler will not call `preventDefault()`
    // This allows the browser to optimize scrolling performance by not waiting for our handling of the scroll event
    // see https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener#passive
    private _startScrollObserver() {
        addEventListener(assignableWindow, 'scroll', this._onScroll, { capture: true })
    }

    private _onScroll = (): void => {
        const candidateNow = Date.now()
        // scrolls caused by a drag fire while the finger is still down, before the touchend
        // that would create a candidate, so they are tracked on the in-flight gesture instead
        if (this._touchStart && isUndefined(this._touchStart.scrollDelayMs)) {
            this._touchStart.scrollDelayMs = candidateNow - this._touchStart.timestamp
        }
        // very naive throttle
        if (candidateNow % 50 === 0) {
            // we can see many scrolls between scheduled checks,
            // so we update scroll delay as we see them
            // to avoid false positives
            this._clicks.forEach((click) => {
                if (isUndefined(click.scrollDelayMs)) {
                    click.scrollDelayMs = candidateNow - click.timestamp
                }
            })
        }
    }

    private _startSelectionChangedObserver() {
        addEventListener(assignableWindow, 'selectionchange', this._onSelectionChange)
    }

    private _onSelectionChange = (): void => {
        this._lastSelectionChanged = Date.now()
    }

    private _startVisibilityChangeObserver() {
        addEventListener(document, 'visibilitychange', this._onVisibilityChange)
    }

    private _onVisibilityChange = (): void => {
        if (document?.visibilityState === 'visible') {
            this._lastVisibilityChange = Date.now()
        }
    }

    // `capture: true` mirrors the scroll observer so we see gestures on nested scrollable
    // elements too. `passive: true` tells the browser we won't call `preventDefault()`.
    private _startSwipeObserver() {
        addEventListener(assignableWindow, 'touchstart', this._onTouchStart, { capture: true, passive: true })
        addEventListener(assignableWindow, 'touchend', this._onTouchEnd, { capture: true, passive: true })
        // a cancelled gesture (system back-swipe, incoming call, etc.) never fires touchend,
        // so clear the start point to avoid measuring the next gesture from a stale origin
        addEventListener(assignableWindow, 'touchcancel', this._onTouchCancel, { capture: true, passive: true })
    }

    private _onTouchStart = (event: Event): void => {
        const touches = (event as TouchEvent).touches
        // only single-finger gestures are swipes; a second finger (pinch/zoom) is not,
        // so a multi-touch start clears any tracked origin rather than measuring against it
        const touch = touches?.length === 1 ? touches[0] : undefined
        this._touchStart = touch ? { x: touch.clientX, y: touch.clientY, timestamp: Date.now() } : undefined
    }

    private _onTouchCancel = (): void => {
        this._touchStart = undefined
    }

    private _onTouchEnd = (event: Event): void => {
        const start = this._touchStart
        this._touchStart = undefined
        if (isUndefined(start)) {
            return
        }

        const touchEvent = event as TouchEvent
        const touch = touchEvent.changedTouches?.[0]
        if (!touch) {
            return
        }

        const dx = touch.clientX - start.x
        const dy = touch.clientY - start.y
        // compare squared distances to avoid a sqrt on every touch; only the actual swipes need it
        const threshold = this._config.swipe_threshold_px
        if (dx * dx + dy * dy < threshold * threshold) {
            // a short movement is a tap or a jitter, not a swipe
            return
        }

        // a gesture that already did something while the finger was down — dragging scrolled
        // the page, a finger-following carousel mutated the DOM, a text selection grew — is not
        // dead, so it never becomes a candidate. surviving candidates keep the touchend
        // timestamp: the thresholds in _checkClicks measure how quickly the page responds
        // after the finger lifts, just as they measure the response to a click
        const gestureCausedActivity =
            isNumber(start.scrollDelayMs) ||
            [this._lastMutation, this._lastSelectionChanged].some(
                (lastActivityAt) => isNumber(lastActivityAt) && lastActivityAt >= start.timestamp
            )
        if (gestureCausedActivity) {
            return
        }

        const swipe = asCandidate(touchEvent, {
            type: 'swipe',
            swipeDirection: swipeDirection(dx, dy),
            swipeDistancePx: Math.round(Math.sqrt(dx * dx + dy * dy)),
        })
        if (!isNull(swipe) && !this._ignore(swipe)) {
            this._clicks.push(swipe)
        }
        this._scheduleCheck()
    }

    private _ignore(candidate: DeadClickCandidate | null): boolean {
        if (!candidate) {
            return true
        }

        const isSwipe = candidate.type === 'swipe'

        // clicks with modifier keys (open in new tab, etc.) are intentional; touch swipes have no modifiers
        if (!isSwipe && !this._config.capture_clicks_with_modifier_keys && hasModifierKey(candidate.originalEvent)) {
            return true
        }

        if (isElementInToolbar(candidate.node)) {
            return true
        }

        const alreadySeenInLastSecond = this._clicks.some((c) => {
            return (
                c.type === candidate.type &&
                c.node === candidate.node &&
                Math.abs(c.timestamp - candidate.timestamp) < 1000
            )
        })
        if (alreadySeenInLastSecond) {
            return true
        }

        // unlike clicks, a swipe is not an anchor activation, so we do not skip anchors for swipes:
        // a swipe that fails to navigate is exactly the signal we want to surface
        if (
            isTag(candidate.node, 'html') ||
            !isElementNode(candidate.node) ||
            (!isSwipe && shouldSkipDeadClick(candidate.node))
        ) {
            return true
        }

        return !shouldCaptureDeadClick(candidate.node, {
            css_selector_ignorelist: this._config.css_selector_ignorelist,
        })
    }

    private _checkClicks() {
        if (!this._clicks.length) {
            return
        }

        clearTimeout(this._checkClickTimer)
        this._checkClickTimer = undefined

        const clicksToCheck = this._clicks
        this._clicks = []

        for (const click of clicksToCheck) {
            click.mutationDelayMs =
                click.mutationDelayMs ??
                (this._lastMutation && click.timestamp <= this._lastMutation
                    ? this._lastMutation - click.timestamp
                    : undefined)
            click.absoluteDelayMs = Date.now() - click.timestamp
            click.selectionChangedDelayMs =
                this._lastSelectionChanged && click.timestamp <= this._lastSelectionChanged
                    ? this._lastSelectionChanged - click.timestamp
                    : undefined
            click.visibilityChangedDelayMs = this._lastVisibilityChange
                ? Math.abs(click.timestamp - this._lastVisibilityChange)
                : undefined

            const scrollTimeout = checkTimeout(click.scrollDelayMs, this._config.scroll_threshold_ms)
            const selectionChangedTimeout = checkTimeout(
                click.selectionChangedDelayMs,
                this._config.selection_change_threshold_ms
            )
            const mutationTimeout = checkTimeout(click.mutationDelayMs, this._config.mutation_threshold_ms)
            // we want to timeout eventually even if nothing else catches it...
            // we leave a little longer than the maximum threshold to give the other checks a chance to catch it
            const absoluteTimeout = checkTimeout(click.absoluteDelayMs, this._config.mutation_threshold_ms * 1.1)

            const hadScroll = isNumber(click.scrollDelayMs) && click.scrollDelayMs < this._config.scroll_threshold_ms
            const hadMutation =
                isNumber(click.mutationDelayMs) && click.mutationDelayMs < this._config.mutation_threshold_ms
            const hadSelectionChange =
                isNumber(click.selectionChangedDelayMs) &&
                click.selectionChangedDelayMs < this._config.selection_change_threshold_ms
            const hadVisibilityChange =
                isNumber(click.visibilityChangedDelayMs) &&
                click.visibilityChangedDelayMs < this._config.selection_change_threshold_ms

            if (hadScroll || hadMutation || hadSelectionChange || hadVisibilityChange) {
                continue
            }

            const visibilityChangedTimeout = checkTimeout(
                click.visibilityChangedDelayMs,
                this._config.selection_change_threshold_ms
            )

            if (
                scrollTimeout ||
                mutationTimeout ||
                absoluteTimeout ||
                selectionChangedTimeout ||
                visibilityChangedTimeout
            ) {
                const prefix = deadEventName(click)
                this._onCapture(click, {
                    [`${prefix}_last_mutation_timestamp`]: this._lastMutation,
                    [`${prefix}_event_timestamp`]: click.timestamp,
                    [`${prefix}_scroll_timeout`]: scrollTimeout,
                    [`${prefix}_mutation_timeout`]: mutationTimeout,
                    [`${prefix}_absolute_timeout`]: absoluteTimeout,
                    [`${prefix}_selection_changed_timeout`]: selectionChangedTimeout,
                    [`${prefix}_visibility_changed_timeout`]: visibilityChangedTimeout,
                })
            } else if (click.absoluteDelayMs < this._config.mutation_threshold_ms) {
                // keep waiting until next check
                this._clicks.push(click)
            }
        }

        this._scheduleCheck()
    }

    private _captureDeadClick(click: DeadClickCandidate, properties: Properties) {
        // TODO need to check safe and captur-able as with autocapture
        // TODO autocaputure config
        const prefix = deadEventName(click)
        this.instance.capture(
            prefix,
            {
                ...properties,
                ...autocapturePropertiesForElement(click.node, {
                    e: click.originalEvent,
                    maskAllElementAttributes: this.instance.config.mask_all_element_attributes,
                    maskAllText: this.instance.config.mask_all_text,
                    elementAttributeIgnoreList: this._config.element_attribute_ignorelist,
                    // TRICKY: it appears that we were moving to elementsChainAsString, but the UI still depends on elements, so :shrug:
                    elementsChainAsString: false,
                    disableCaptureUrlHashes: this.instance.config.disable_capture_url_hashes,
                }).props,
                [`${prefix}_scroll_delay_ms`]: click.scrollDelayMs,
                [`${prefix}_mutation_delay_ms`]: click.mutationDelayMs,
                [`${prefix}_absolute_delay_ms`]: click.absoluteDelayMs,
                [`${prefix}_selection_changed_delay_ms`]: click.selectionChangedDelayMs,
                [`${prefix}_visibility_changed_delay_ms`]: click.visibilityChangedDelayMs,
                // undefined for clicks (stripped on serialization), like the delay fields above
                $dead_swipe_direction: click.swipeDirection,
                $dead_swipe_distance_px: click.swipeDistancePx,
            },
            {
                timestamp: new Date(click.timestamp),
            }
        )
    }
}

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.initDeadClicksAutocapture = (ph, config) =>
    new LazyLoadedDeadClicksAutocapture(ph, config)

export default LazyLoadedDeadClicksAutocapture
