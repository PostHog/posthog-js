import { document } from '@posthog/browser-common/utils/globals'
import { assignableWindow, LazyLoadedDeadClicksAutocaptureInterface } from '../utils/globals'
import { PostHog } from '../posthog-core'
import { isNull, isNumber, isUndefined } from '@posthog/core'
import {
    getEventTarget,
    shouldCaptureDeadClick,
    shouldSkipDeadClick,
} from '@posthog/browser-common/utils/autocapture-utils'
import { DeadClickCandidate, DeadClicksAutoCaptureConfig, Properties } from '../types'
import { autocapturePropertiesForElement } from '../autocapture'
import { isElementInToolbar, isElementNode, isTag } from '@posthog/browser-common/utils/element-utils'
import { getNativeMutationObserverImplementation } from '@posthog/browser-common/utils/prototype-utils'
import { addEventListener } from '@posthog/browser-common/utils/general-utils'

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

// surfaces that respond to a gesture without anything our observers can see — a canvas or
// WebGL repaint is not a DOM mutation, and native media controls live in a closed UA shadow
// root — so a swipe over them can never be judged dead
const UNOBSERVABLE_SURFACE_SELECTOR = 'canvas,video,audio,embed,object'

// a click within this window of a visibility or window focus/blur change is treated as the click
// that woke/focused the tab (or opened a new tab/window) and suppressed rather than flagged dead.
// wider than the other thresholds because a real "tab back, then click the page" gesture has a
// human-scale gap (refocus, move the mouse, click); still short enough that a genuinely dead click
// a while after refocusing is caught.
const LIVENESS_SUPPRESSION_MS = 1000

function hasModifierKey(event: MouseEvent | TouchEvent): boolean {
    return event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
}

function checkTimeout(value: number | undefined, thresholdMs: number) {
    return isNumber(value) && value >= thresholdMs
}

// a liveness transition only counts if it fired within the suppression window on one side of the
// click. this is the single definition of "in window" — it gates every recorded delay, so once a
// delay lands on a candidate `_checkClicks` can trust it is already in range.
function livenessDelayInWindow(delay: number): number | undefined {
    return delay >= 0 && delay < LIVENESS_SUPPRESSION_MS ? delay : undefined
}

// a liveness signal (visibility/focus) that fired shortly BEFORE the click — the click that woke
// or refocused the tab. read once when the candidate is queued; only a change inside the
// suppression window counts, so a long-ago transition can neither suppress the click nor (as it
// once wrongly did) mark it dead. the AFTER-the-click direction is recorded separately, as the
// event fires, by `_recordLivenessSignal`.
function priorLivenessDelay(clickTimestamp: number, lastSeenAt: number | undefined): number | undefined {
    return lastSeenAt ? livenessDelayInWindow(clickTimestamp - lastSeenAt) : undefined
}

// How dead-click detection works
// ================================
// A click (or swipe) is queued as a candidate, then re-examined ~1s later in `_checkClicks`. It is
// reported as a `$dead_click` only if — after the click — NO liveness/suppression signal fired
// within its window AND at least one timeout signal fired. In short: something-happened-fast wins
// (alive), otherwise nothing-happened-in-time loses (dead).
//
// Gate signals (checked in `_ignore` before the click is ever queued — never even a candidate):
//   - element is inside the PostHog toolbar
//   - same node clicked again within 1s (dedupe of repeated clicks)
//   - target is the <html> node or not an element
//   - target matches `css_selector_ignorelist`
//   - a modifier key is held (ctrl/meta/alt/shift) unless `capture_clicks_with_modifier_keys`
//   - (clicks only) target is an anchor — a legitimate activation; swipes are still candidates
//
// Liveness / suppression signals (any one, within its window after the click => alive, dropped).
// These say "the click did something", so they only ever suppress; none can mark a click dead:
//   - mutation:   a DOM mutation           < mutation_threshold_ms (default 2500)
//   - scroll:     the page/an element scrolled < scroll_threshold_ms (default 100)
//   - selection:  a selectionchange        < selection_change_threshold_ms (default 100)
//   - visibility: a visibilitychange (either direction — the tab going hidden because the click
//                 opened a new tab, or becoming visible as the click woke/focused it)
//                 < LIVENESS_SUPPRESSION_MS on either side of the click
//   - focus:      a window focus/blur (a click that opened a new window/popup may only surface as
//                 the current window losing focus) < LIVENESS_SUPPRESSION_MS on either side
// visibility/focus are recorded onto each queued candidate the instant they fire (like scroll), not
// read from a single shared timestamp when the click is checked. that matters because a click that
// hides/blurs the tab suspends the ~1s `_checkClicks` timer while hidden; by the time it resumes the
// tab has usually come back, and a shared timestamp would have been overwritten by that later
// transition, losing the click-correlated one and misjudging the click as dead.
//
// Timeout signals (a click with no liveness signal is dead if any one fired). Note visibility and
// focus are deliberately absent here — they are liveness-only and never mark a click dead:
//   - mutation timeout:  a mutation, but only after mutation_threshold_ms
//   - scroll timeout:    a scroll, but only after scroll_threshold_ms
//   - selection timeout: a selectionchange, but only after selection_change_threshold_ms
//   - absolute timeout:  nothing at all within mutation_threshold_ms * 1.1 (the catch-all backstop)
class LazyLoadedDeadClicksAutocapture implements LazyLoadedDeadClicksAutocaptureInterface {
    private _mutationObserver: MutationObserver | undefined
    private _lastMutation: number | undefined
    private _lastScroll: number | undefined
    private _lastSelectionChanged: number | undefined
    private _lastVisibilityChange: number | undefined
    private _lastFocusChange: number | undefined
    private _clicks: DeadClickCandidate[] = []
    private _checkClickTimer: number | undefined
    private _touchStart: { x: number; y: number; timestamp: number } | undefined
    private _deadSwipesCaptured = 0
    private _hasUnobservableSurfaces: boolean | undefined
    private _surfacesCheckedAt: number | undefined
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
        max_dead_swipes_per_page_load: 10,
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
            max_dead_swipes_per_page_load:
                providedConfig?.max_dead_swipes_per_page_load ?? defaultConfig.max_dead_swipes_per_page_load,
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
    }

    start(observerTarget: Node) {
        this._startClickObserver()
        this._startScrollObserver()
        this._startSelectionChangedObserver()
        this._startVisibilityChangeObserver()
        this._startFocusChangeObserver()
        this._startMutationObserver(observerTarget)
        if (this._config.capture_dead_swipes) {
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
        assignableWindow.removeEventListener('blur', this._onFocusChange)
        assignableWindow.removeEventListener('focus', this._onFocusChange)
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
            this._queueCandidate(click)
        }
        this._scheduleCheck()
    }

    // queue a candidate, first recording any liveness signal that fired just BEFORE the click (the
    // click that woke/refocused the tab). the AFTER-the-click direction is stamped later, as the
    // event fires, by `_recordLivenessSignal`.
    private _queueCandidate(candidate: DeadClickCandidate): void {
        candidate.visibilityChangedDelayMs = priorLivenessDelay(candidate.timestamp, this._lastVisibilityChange)
        candidate.focusChangedDelayMs = priorLivenessDelay(candidate.timestamp, this._lastFocusChange)
        this._clicks.push(candidate)
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
        this._lastScroll = candidateNow
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
        // record both directions: a tab going _hidden_ right after a click (the click opened a new
        // tab) is as much a liveness signal as it becoming visible (the click that woke the tab).
        // stamp queued candidates now, before a hidden tab can suspend `_checkClicks`.
        const firedAt = Date.now()
        this._lastVisibilityChange = firedAt
        this._recordLivenessSignal('visibilityChangedDelayMs', firedAt)
    }

    // a click that opens a new window/popup may leave the current tab visible, so its only trace is
    // the window losing focus. focus/blur are liveness signals too — they suppress a dead click, and
    // like visibility they never cause one.
    private _startFocusChangeObserver() {
        addEventListener(assignableWindow, 'blur', this._onFocusChange)
        addEventListener(assignableWindow, 'focus', this._onFocusChange)
    }

    private _onFocusChange = (): void => {
        const firedAt = Date.now()
        this._lastFocusChange = firedAt
        this._recordLivenessSignal('focusChangedDelayMs', firedAt)
    }

    // stamp each queued candidate with how long AFTER its click this liveness signal fired, the
    // moment the event arrives. recording it immediately — rather than reading a single shared
    // timestamp when `_checkClicks` finally runs — is what makes it robust: a hidden tab suspends
    // `_checkClicks`, and by the time it resumes a later transition (the tab coming back) would have
    // overwritten the click-correlated one. keeps the closest transition, only within the window.
    private _recordLivenessSignal(field: 'visibilityChangedDelayMs' | 'focusChangedDelayMs', firedAt: number): void {
        this._clicks.forEach((click) => {
            const delay = livenessDelayInWindow(firedAt - click.timestamp)
            if (isNumber(delay) && (isUndefined(click[field]) || delay < click[field]!)) {
                click[field] = delay
            }
        })
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
        if (isUndefined(start) || this._deadSwipesCaptured >= this._config.max_dead_swipes_per_page_load) {
            return
        }

        const touchEvent = event as TouchEvent
        const touch = touchEvent.changedTouches?.[0]
        if (!touch) {
            return
        }

        const dx = touch.clientX - start.x
        const dy = touch.clientY - start.y
        const distanceSq = dx * dx + dy * dy
        // compare squared distances to avoid a sqrt on every touch; only the actual swipes need it
        const threshold = this._config.swipe_threshold_px
        if (distanceSq < threshold * threshold) {
            // a short movement is a tap or a jitter, not a swipe
            return
        }

        // a gesture that already did something while the finger was down — dragging scrolled
        // the page, a finger-following carousel mutated the DOM, a text selection grew — is not
        // dead, so it never becomes a candidate. surviving candidates keep the touchend
        // timestamp: the thresholds in _checkClicks measure how quickly the page responds
        // after the finger lifts, just as they measure the response to a click
        const gestureCausedActivity = [this._lastScroll, this._lastMutation, this._lastSelectionChanged].some(
            (lastActivityAt) => isNumber(lastActivityAt) && lastActivityAt >= start.timestamp
        )
        if (gestureCausedActivity) {
            return
        }

        // hit-test the stack under where the finger landed rather than the candidate's
        // ancestors: canvas apps usually receive their touches through transparent overlay
        // elements stacked on top of the canvas, so the surface is beneath, not above.
        // this runs at most once per dead-candidate gesture, when the page is provably idle
        // (the activity gate above just passed), so a forced layout flush is unlikely
        if (this._pageHasUnobservableSurfaces()) {
            const stack = document?.elementsFromPoint?.(start.x, start.y) ?? []
            if (stack.some((el) => el.matches?.(UNOBSERVABLE_SURFACE_SELECTOR))) {
                return
            }
        }

        const swipe = asCandidate(touchEvent, {
            type: 'swipe',
            swipeDirection: swipeDirection(dx, dy),
            swipeDistancePx: Math.round(Math.sqrt(distanceSq)),
        })
        if (!isNull(swipe) && !this._ignore(swipe)) {
            this._queueCandidate(swipe)
        }
        this._scheduleCheck()
    }

    // whether the page contains surfaces whose response to a gesture we cannot observe —
    // cached, recomputed lazily and only when the DOM has mutated since the last look
    private _pageHasUnobservableSurfaces(): boolean {
        const domChangedSinceCheck =
            isUndefined(this._surfacesCheckedAt) ||
            (isNumber(this._lastMutation) && this._lastMutation > this._surfacesCheckedAt)
        if (isUndefined(this._hasUnobservableSurfaces) || domChangedSinceCheck) {
            this._surfacesCheckedAt = Date.now()
            this._hasUnobservableSurfaces = !!document?.querySelector(UNOBSERVABLE_SURFACE_SELECTOR)
        }
        return !!this._hasUnobservableSurfaces
    }

    private _ignore(candidate: DeadClickCandidate | null): boolean {
        if (!candidate) {
            return true
        }
        // swipes run only the shared gates; clicks layer their own intent gates on top
        return candidate.type === 'swipe' ? this._ignoreCommon(candidate) : this._ignoreClick(candidate)
    }

    // gates that apply to every dead candidate, whatever the gesture
    private _ignoreCommon(candidate: DeadClickCandidate): boolean {
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

        if (isTag(candidate.node, 'html') || !isElementNode(candidate.node)) {
            return true
        }

        return !shouldCaptureDeadClick(candidate.node, {
            css_selector_ignorelist: this._config.css_selector_ignorelist,
        })
    }

    // click-only gates, layered on top of the shared ones
    private _ignoreClick(candidate: DeadClickCandidate): boolean {
        // clicks with modifier keys (open in new tab, etc.) are intentional; touch swipes have no modifiers
        if (!this._config.capture_clicks_with_modifier_keys && hasModifierKey(candidate.originalEvent)) {
            return true
        }

        if (this._ignoreCommon(candidate)) {
            return true
        }

        // an anchor is a legitimate click activation so we skip it, but a swipe that fails to
        // navigate is the signal we want — which is why anchors are skipped for clicks only.
        // reaching here means _ignoreCommon confirmed an element node, so this is safe to call
        return shouldSkipDeadClick(candidate.node)
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
            // visibilityChangedDelayMs / focusChangedDelayMs are already recorded on the candidate as
            // the events fire (see `_queueCandidate` for the before-the-click direction and
            // `_recordLivenessSignal` for after) — nothing to compute here. both are liveness-only: a
            // tab/window transition near a click is evidence the click did something, so they only
            // ever _suppress_ a dead click and (unlike mutation/selection) feed no timeout branch.

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
            // visibility/focus delays are only ever recorded when already inside the suppression
            // window (see `livenessDelayInWindow`), so their presence alone means "suppress"
            const hadVisibilityChange = isNumber(click.visibilityChangedDelayMs)
            const hadFocusChange = isNumber(click.focusChangedDelayMs)

            if (hadScroll || hadMutation || hadSelectionChange || hadVisibilityChange || hadFocusChange) {
                continue
            }

            if (scrollTimeout || mutationTimeout || absoluteTimeout || selectionChangedTimeout) {
                const prefix = deadEventName(click)
                if (prefix === '$dead_swipe') {
                    if (this._deadSwipesCaptured >= this._config.max_dead_swipes_per_page_load) {
                        // the page-load budget for dead swipes is spent — drop, don't requeue
                        continue
                    }
                    this._deadSwipesCaptured++
                }
                this._onCapture(click, {
                    [`${prefix}_last_mutation_timestamp`]: this._lastMutation,
                    [`${prefix}_event_timestamp`]: click.timestamp,
                    [`${prefix}_scroll_timeout`]: scrollTimeout,
                    [`${prefix}_mutation_timeout`]: mutationTimeout,
                    [`${prefix}_absolute_timeout`]: absoluteTimeout,
                    [`${prefix}_selection_changed_timeout`]: selectionChangedTimeout,
                    // visibility changes only ever suppress a dead click, never cause one; kept in the
                    // payload (always false) so the event shape is unchanged for existing consumers
                    [`${prefix}_visibility_changed_timeout`]: false,
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
                [`${prefix}_focus_changed_delay_ms`]: click.focusChangedDelayMs,
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
