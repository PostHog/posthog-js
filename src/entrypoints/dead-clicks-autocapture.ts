import { assignableWindow, LazyLoadedDeadClicksAutocapture } from '../utils/globals'
import { PostHog } from '../posthog-core'
import { isNull, isNumber, isUndefined } from '../utils/type-utils'
import { getEventTarget, isElementNode, isTag } from '../autocapture-utils'
import { Properties } from '../types'
import { getPropertiesFromElement } from '../autocapture'

// by default if a click is followed by a sroll within 200ms it is not a dead click
const SCROLL_THRESHOLD_MS = 200
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
    private _lastScroll: number | undefined
    private _clicks: Click[] = []
    private _checkClickTimer: number | undefined

    constructor(readonly instance: PostHog) {}

    start(observerTarget: Node) {
        this._startClickObserver(observerTarget)
        this._startScrollObserver(observerTarget)
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
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private onMutation(_mutations: MutationRecord[]): void {
        // we don't actually care about the content of the mutations, right now
        this._lastMutation = Date.now()
    }

    private _startClickObserver(clickTarget: Node) {
        clickTarget.addEventListener('click', (e) => this._onClick(e))
    }

    private _onClick(event: Event): void {
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

    private _startScrollObserver(observerTarget: Node) {
        observerTarget.addEventListener('scroll', (event) => this._onScroll(event))
    }

    private _onScroll(event: Event): void {
        this._lastScroll = event.timeStamp
    }

    private _ignoreClick(click: Click | null): boolean {
        if (!click) {
            return true
        }

        const alreadyClickedInLastSecond = this._clicks.some(
            (c) => c.node === click.node && Math.abs(c.timestamp - click.timestamp) < 1000
        )
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
            // is click timestamp less than CLICK_THRESHOLD ms before last scroll
            click.scrollDelayMs = this._lastScroll ? click.timestamp - this._lastScroll : undefined
            click.mutationDelayMs = this._lastMutation ? click.timestamp - this._lastMutation : undefined
            click.absoluteDelayMs = Date.now() - click.timestamp
            const scrollTimeout = isNumber(click.scrollDelayMs) && click.scrollDelayMs >= SCROLL_THRESHOLD_MS
            const mutationTimeout = isNumber(click.mutationDelayMs) && click.mutationDelayMs >= MUTATION_THRESHOLD_MS
            const absoluteDelay = Math.abs(click.timestamp - Date.now())
            const absoluteTimeout = absoluteDelay > MUTATION_THRESHOLD_MS * 2
            const isDeadClick = scrollTimeout || mutationTimeout || absoluteTimeout

            if (isDeadClick) {
                this._captureDeadClick(click, {
                    $dead_click_last_scroll_timestamp: this._lastScroll,
                    $dead_click_last_mutation_timestamp: this._lastMutation,
                    $dead_click_event_timestamp: click.timestamp,
                    $dead_click_scroll_timeout: scrollTimeout,
                    $dead_click_mutation_timeout: mutationTimeout,
                    $dead_click_absolute_timeout: absoluteTimeout,
                    $dead_click_absolute_delay: absoluteDelay,
                })
            } else if (absoluteDelay < MUTATION_THRESHOLD_MS) {
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
