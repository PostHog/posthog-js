// Naive rage click implementation: If mouse has not moved further than thresholdPx
// over clickCount clicks with max timeoutMs between clicks, it's
// counted as a rage click

import { isObject } from '@posthog/core'
import type { RageclickConfig } from '@posthog/types'

const DEFAULT_THRESHOLD_PX = 30
const DEFAULT_TIMEOUT_MS = 1000
const DEFAULT_CLICK_COUNT = 3

export default class RageClick {
    clicks: { x: number; y: number; timestamp: number }[]
    lastTarget: EventTarget | null
    lastTimestamp: number

    thresholdPx: number
    timeoutMs: number
    clickCount: number
    disabled: boolean

    constructor(rageclickConfig: RageclickConfig | boolean) {
        this.disabled = rageclickConfig === false
        const conf = isObject(rageclickConfig) ? rageclickConfig : {}

        this.thresholdPx = conf.threshold_px || DEFAULT_THRESHOLD_PX
        this.timeoutMs = conf.timeout_ms || DEFAULT_TIMEOUT_MS
        this.clickCount = conf.click_count || DEFAULT_CLICK_COUNT

        this.clicks = []
        this.lastTarget = null
        this.lastTimestamp = 0
    }

    isRageClick(x: number, y: number, timestamp: number, target?: EventTarget | null): boolean {
        if (this.disabled) {
            return false
        }

        // Clicking a <label> makes the browser dispatch a second, synthetic click at the labeled
        // control. Chromium and WebKit give that forwarded click `detail === 0`, but Firefox sends
        // `detail === 1`, so the detail value can't tell it apart from a genuine click. Recognise it
        // by its target instead: the control of the <label> the previous click landed in, dispatched
        // a few milliseconds later. Counting it would double-count a single user click and could
        // trigger a false rage click, so drop it without recording it.
        // The target may be a non-Element (e.g. document, when a click is dispatched on it), which has
        // no closest(), so narrow to Element before calling it.
        const previousLabel =
            this.lastTarget instanceof Element ? (this.lastTarget.closest('label') as HTMLLabelElement | null) : null
        const isForwardedLabelClick =
            !!previousLabel && !!target && previousLabel.control === target && timestamp - this.lastTimestamp < 50
        this.lastTarget = target ?? null
        this.lastTimestamp = timestamp
        if (isForwardedLabelClick) {
            return false
        }

        const lastClick = this.clicks[this.clicks.length - 1]
        if (
            lastClick &&
            Math.abs(x - lastClick.x) + Math.abs(y - lastClick.y) < this.thresholdPx &&
            timestamp - lastClick.timestamp < this.timeoutMs
        ) {
            this.clicks.push({ x, y, timestamp })

            if (this.clicks.length === this.clickCount) {
                return true
            }
        } else {
            this.clicks = [{ x, y, timestamp }]
        }

        return false
    }
}
