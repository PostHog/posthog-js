import { assignableWindow, LazyLoadedDeadClicksAutocapture } from '../utils/globals'
import { PostHog } from '../posthog-core'
import { isNull, isNumber, isUndefined } from '../utils/type-utils'
import { getEventTarget, isElementNode, isTag } from '../autocapture-utils'
import { DeadClicksAutoCaptureConfig, Properties } from '../types'
import { getPropertiesFromElement } from '../autocapture'

const DEFAULT_CONFIG: Required<DeadClicksAutoCaptureConfig> = {
    scroll_threshold_ms: 100,
    selection_change_threshold_ms: 100,
    mutation_threshold_ms: 2500,
}

interface Click {
    node: Element
    timestamp: number
    // time between click and the most recent scroll
    scrollDelayMs?: number
    // time between click and the most recent mutation
    mutationDelayMs?: number
    // time between click and the most recent selection changed event
    selectionChangedDelayMs?: number
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

function checkTimeout(value: number | undefined, thresholdMs: number) {
    return isNumber(value) && value >= thresholdMs
}

class _LazyLoadedDeadClicksAutocapture implements LazyLoadedDeadClicksAutocapture {
    private _mutationObserver: MutationObserver | undefined
    private _lastMutation: number | undefined
    private _lastSelectionChanged: number | undefined
    private _clicks: Click[] = []
    private _checkClickTimer: number | undefined
    private _config: Required<DeadClicksAutoCaptureConfig>

    private asRequiredConfig(config?: DeadClicksAutoCaptureConfig): Required<DeadClicksAutoCaptureConfig> {
        const result = { ...DEFAULT_CONFIG }

        for (const key in config) {
            const k = key as keyof DeadClicksAutoCaptureConfig
            result[k] = config?.[k] ?? DEFAULT_CONFIG[k]
        }

        return result
    }

    constructor(readonly instance: PostHog, config?: DeadClicksAutoCaptureConfig) {
        this._config = this.asRequiredConfig(config)
    }

    start(observerTarget: Node) {
        this._startClickObserver()
        this._startScrollObserver()
        this._startSelectionChangedObserver()
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
        assignableWindow.removeEventListener('selectionchange', this._onSelectionChange)
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

    private _startSelectionChangedObserver() {
        assignableWindow.addEventListener('selectionchange', this._onSelectionChange)
    }

    private _onSelectionChange = (): void => {
        this._lastSelectionChanged = Date.now()
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
                click.mutationDelayMs ??
                (this._lastMutation && click.timestamp <= this._lastMutation
                    ? this._lastMutation - click.timestamp
                    : undefined)
            click.absoluteDelayMs = Date.now() - click.timestamp
            click.selectionChangedDelayMs =
                this._lastSelectionChanged && click.timestamp <= this._lastSelectionChanged
                    ? this._lastSelectionChanged - click.timestamp
                    : undefined

            const scrollTimeout = checkTimeout(click.scrollDelayMs, this._config.scroll_threshold_ms)
            const selectionChangedTimeout = checkTimeout(
                click.selectionChangedDelayMs,
                this._config.selection_change_threshold_ms
            )
            const mutationTimeout = checkTimeout(click.mutationDelayMs, this._config.mutation_threshold_ms)
            const absoluteTimeout = checkTimeout(click.absoluteDelayMs, this._config.mutation_threshold_ms)

            const hadScroll = isNumber(click.scrollDelayMs) && click.scrollDelayMs < this._config.scroll_threshold_ms
            const hadMutation =
                isNumber(click.mutationDelayMs) && click.mutationDelayMs < this._config.mutation_threshold_ms
            const hadSelectionChange =
                isNumber(click.selectionChangedDelayMs) &&
                click.selectionChangedDelayMs < this._config.selection_change_threshold_ms

            if (hadScroll || hadMutation || hadSelectionChange) {
                // ignore clicks that had a scroll or mutation
                continue
            }

            if (scrollTimeout || mutationTimeout || absoluteTimeout || selectionChangedTimeout) {
                this._captureDeadClick(click, {
                    $dead_click_last_mutation_timestamp: this._lastMutation,
                    $dead_click_event_timestamp: click.timestamp,
                    $dead_click_scroll_timeout: scrollTimeout,
                    $dead_click_mutation_timeout: mutationTimeout,
                    $dead_click_absolute_timeout: absoluteTimeout,
                    $dead_click_selection_changed_timeout: selectionChangedTimeout,
                })
            } else if (click.absoluteDelayMs < this._config.mutation_threshold_ms) {
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
            $dead_click_selection_changed_delay_ms: click.selectionChangedDelayMs,
            timestamp: click.timestamp,
        })
    }
}

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.initDeadClicksAutocapture = (ph) => new _LazyLoadedDeadClicksAutocapture(ph)

export default _LazyLoadedDeadClicksAutocapture
