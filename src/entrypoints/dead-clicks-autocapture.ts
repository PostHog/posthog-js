import { assignableWindow, LazyLoadedDeadClicksAutocapture } from '../utils/globals'
import { PostHog } from '../posthog-core'
import { isNull, isNumber, isUndefined } from '../utils/type-utils'
import { getEventTarget, isElementNode, isTag } from '../autocapture-utils'
import { Properties } from '../types'
import { getPropertiesFromElement } from '../autocapture'

// by default if a click is followed by a sroll within 100ms it is not a dead click
const SCROLL_THRESHOLD_MS = 100
// by default if a click is followed by a mutation within 2500ms it is not a dead click
const MUTATION_THRESHOLD_MS = 2500

interface Click {
    node: Element
    timestamp: number
    scrollDelayMs?: number
    mutationDelayMs?: number
    // if neither scroll nor mutation seen before threshold passed
    absoluteDelayMs?: number
}

function asClick(event: Event): Click | null {
    const eventTarget = getEventTarget(event)
    if (eventTarget) {
        return {
            node: eventTarget,
            timestamp: Date.now(),
        }
    }
    return null
}

class _LazyLoadedDeadClicksAutocapture implements LazyLoadedDeadClicksAutocapture {
    private _mutationObserver: MutationObserver | undefined
    private _lastMutation: number | undefined
    private _clicks: Click[] = []
    private _checkClickTimer: number | undefined

    constructor(readonly instance: PostHog) {}

    start(observerTarget: Node) {
        this._startClickObserver()
        this._startScrollObserver()
        this._startMutationObserver(observerTarget)
    }

    private _startMutationObserver(observerTarget: Node) {
        if (!this._mutationObserver) {
            this._mutationObserver = new MutationObserver((mutations) => {
                this.onMutation(mutations)
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
        assignableWindow.removeEventListener('scroll', this._onScroll, true)
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private onMutation(_mutations: MutationRecord[]): void {
        // we don't actually care about the content of the mutations, right now
        this._lastMutation = Date.now()
    }

    private _startClickObserver() {
        assignableWindow.addEventListener('click', this._onClick)
    }

    private _onClick = (event: Event): void => {
        const click = asClick(event)
        if (!isNull(click) && !this._ignoreClick(click)) {
            this._clicks.push(click)
        }

        if (this._clicks.length && isUndefined(this._checkClickTimer)) {
            this._checkClickTimer = assignableWindow.setTimeout(() => {
                this._checkClicks()
            }, 1000)
        }
    }

    private _startScrollObserver() {
        // setting the third argument to `true` means that we will receive scroll events for other scrollable elements
        // on the page, not just the window
        // see https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener#usecapture
        assignableWindow.addEventListener('scroll', this._onScroll, true)
    }

    private _onScroll = (): void => {
        const candidateNow = Date.now()
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

    private _ignoreClick(click: Click | null): boolean {
        if (!click) {
            return true
        }

        const alreadyClickedInLastSecond = this._clicks.some((c) => {
            return c.node === click.node && Math.abs(c.timestamp - click.timestamp) < 1000
        })

        if (alreadyClickedInLastSecond) {
            return true
        }

        // ignore clicks that might open a new window
        if (
            click.node.tagName === 'A' &&
            click.node.hasAttribute('target') &&
            click.node.getAttribute('target') !== '_self'
        ) {
            return true
        }

        if (isTag(click.node, 'html') || !isElementNode(click.node)) {
            return true
        }

        return false
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
                this._lastMutation && click.timestamp <= this._lastMutation
                    ? this._lastMutation - click.timestamp
                    : undefined
            click.absoluteDelayMs = Date.now() - click.timestamp
            const scrollTimeout = isNumber(click.scrollDelayMs) && click.scrollDelayMs >= SCROLL_THRESHOLD_MS
            const mutationTimeout = isNumber(click.mutationDelayMs) && click.mutationDelayMs >= MUTATION_THRESHOLD_MS
            const absoluteTimeout = click.absoluteDelayMs > MUTATION_THRESHOLD_MS
            const hadScroll = isNumber(click.scrollDelayMs) && click.scrollDelayMs < SCROLL_THRESHOLD_MS
            const hadMutation = isNumber(click.mutationDelayMs) && click.mutationDelayMs < MUTATION_THRESHOLD_MS

            if (hadScroll || hadMutation) {
                // ignore clicks that had a scroll or mutation
                continue
            }

            if (scrollTimeout || mutationTimeout || absoluteTimeout) {
                this._captureDeadClick(click, {
                    $dead_click_last_mutation_timestamp: this._lastMutation,
                    $dead_click_event_timestamp: click.timestamp,
                    $dead_click_scroll_timeout: scrollTimeout,
                    $dead_click_mutation_timeout: mutationTimeout,
                    $dead_click_absolute_timeout: absoluteTimeout,
                })
            } else if (click.absoluteDelayMs < MUTATION_THRESHOLD_MS) {
                // keep waiting until next check
                this._clicks.push(click)
            }
        }

        if (this._clicks.length && isUndefined(this._checkClickTimer)) {
            this._checkClickTimer = assignableWindow.setTimeout(() => {
                this._checkClicks()
            }, 1000)
        }
    }

    private _captureDeadClick(click: Click, properties: Properties) {
        // TODO need to check safe and captur-able as with autocapture
        // TODO autocaputure config
        const autocaptureProperties = getPropertiesFromElement(click.node, false, false, [])
        this.instance.capture('$dead_click', {
            ...properties,
            ...autocaptureProperties,
            $dead_click_scroll_delay_ms: click.scrollDelayMs,
            $dead_click_mutation_delay_ms: click.mutationDelayMs,
            $dead_click_absolute_delay_ms: click.absoluteDelayMs,
            timestamp: click.timestamp,
        })
    }
}

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.initDeadClicksAutocapture = (ph) => new _LazyLoadedDeadClicksAutocapture(ph)

export default _LazyLoadedDeadClicksAutocapture
