import { assignableWindow, LazyLoadedDeadClicksAutocaptureInterface } from '../utils/globals'
import { PostHog } from '../posthog-core'
import { isNull, isNumber, isUndefined } from '@posthog/core'
import { autocaptureCompatibleElements, getEventTarget } from '../autocapture-utils'
import { DeadClickCandidate, DeadClicksAutoCaptureConfig, Properties } from '../types'
import { autocapturePropertiesForElement } from '../autocapture'
import { isElementInToolbar, isElementNode, isTag } from '../utils/element-utils'
import { getNativeMutationObserverImplementation } from '../utils/prototype-utils'
import { addEventListener } from '../utils'

function asClick(event: MouseEvent): DeadClickCandidate | null {
    const eventTarget = getEventTarget(event)
    if (eventTarget) {
        return {
            node: eventTarget,
            originalEvent: event,
            timestamp: Date.now(),
        }
    }
    return null
}

function checkTimeout(value: number | undefined, thresholdMs: number) {
    return isNumber(value) && value >= thresholdMs
}

class LazyLoadedDeadClicksAutocapture implements LazyLoadedDeadClicksAutocaptureInterface {
    private _mutationObserver: MutationObserver | undefined
    private _lastMutation: number | undefined
    private _lastSelectionChanged: number | undefined
    private _clicks: DeadClickCandidate[] = []
    private _checkClickTimer: number | undefined
    private _config: Required<DeadClicksAutoCaptureConfig>
    private _onCapture: (click: DeadClickCandidate, properties: Properties) => void

    private _defaultConfig = (defaultOnCapture: (click: DeadClickCandidate, properties: Properties) => void) => ({
        element_attribute_ignorelist: [],
        scroll_threshold_ms: 100,
        selection_change_threshold_ms: 100,
        mutation_threshold_ms: 2500,
        __onCapture: defaultOnCapture,
    })

    private _asRequiredConfig(providedConfig?: DeadClicksAutoCaptureConfig): Required<DeadClicksAutoCaptureConfig> {
        const defaultConfig = this._defaultConfig(providedConfig?.__onCapture || this._captureDeadClick.bind(this))
        return {
            element_attribute_ignorelist:
                providedConfig?.element_attribute_ignorelist ?? defaultConfig.element_attribute_ignorelist,
            scroll_threshold_ms: providedConfig?.scroll_threshold_ms ?? defaultConfig.scroll_threshold_ms,
            selection_change_threshold_ms:
                providedConfig?.selection_change_threshold_ms ?? defaultConfig.selection_change_threshold_ms,
            mutation_threshold_ms: providedConfig?.mutation_threshold_ms ?? defaultConfig.mutation_threshold_ms,
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
        this._startMutationObserver(observerTarget)
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
        const click = asClick(event as MouseEvent)
        if (!isNull(click) && !this._ignoreClick(click)) {
            this._clicks.push(click)
        }

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

    private _ignoreClick(click: DeadClickCandidate | null): boolean {
        if (!click) {
            return true
        }

        if (isElementInToolbar(click.node)) {
            return true
        }

        const alreadyClickedInLastSecond = this._clicks.some((c) => {
            return c.node === click.node && Math.abs(c.timestamp - click.timestamp) < 1000
        })

        if (alreadyClickedInLastSecond) {
            return true
        }

        if (
            isTag(click.node, 'html') ||
            !isElementNode(click.node) ||
            autocaptureCompatibleElements.includes(click.node.tagName.toLowerCase())
        ) {
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
            // we want to timeout eventually even if nothing else catches it...
            // we leave a little longer than the maximum threshold to give the other checks a chance to catch it
            const absoluteTimeout = checkTimeout(click.absoluteDelayMs, this._config.mutation_threshold_ms * 1.1)

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
                this._onCapture(click, {
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

    private _captureDeadClick(click: DeadClickCandidate, properties: Properties) {
        // TODO need to check safe and captur-able as with autocapture
        // TODO autocaputure config
        this.instance.capture(
            '$dead_click',
            {
                ...properties,
                ...autocapturePropertiesForElement(click.node, {
                    e: click.originalEvent,
                    maskAllElementAttributes: this.instance.config.mask_all_element_attributes,
                    maskAllText: this.instance.config.mask_all_text,
                    elementAttributeIgnoreList: this._config.element_attribute_ignorelist,
                    // TRICKY: it appears that we were moving to elementsChainAsString, but the UI still depends on elements, so :shrug:
                    elementsChainAsString: false,
                }).props,
                $dead_click_scroll_delay_ms: click.scrollDelayMs,
                $dead_click_mutation_delay_ms: click.mutationDelayMs,
                $dead_click_absolute_delay_ms: click.absoluteDelayMs,
                $dead_click_selection_changed_delay_ms: click.selectionChangedDelayMs,
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
