// Naive rage click implementation: If mouse has not moved further than rageClickThresholdPx
// over rageClickClickCount clicks with max rageClickTimeoutMs between clicks, it's
// counted as a rage click

import { isObject } from '@posthog/core'
import { RageclickConfig } from '../types'

const DEFAULT_RAGE_CLICK_THRESHOLD_PX = 30
const DEFAULT_RAGE_CLICK_TIMEOUT_MS = 1000
const DEFAULT_RAGE_CLICK_CLICK_COUNT = 3

export default class RageClick {
    clicks: { x: number; y: number; timestamp: number }[]

    thresholdPx: number
    timeoutMs: number
    clickCount: number

    constructor(rageclickConfig: RageclickConfig | boolean) {
        const conf = isObject(rageclickConfig) ? rageclickConfig : {}

        this.thresholdPx = conf.threshold_px || DEFAULT_RAGE_CLICK_THRESHOLD_PX
        this.timeoutMs = conf.timeout_ms || DEFAULT_RAGE_CLICK_TIMEOUT_MS
        this.clickCount = conf.click_count || DEFAULT_RAGE_CLICK_CLICK_COUNT

        this.clicks = []
    }

    isRageClick(x: number, y: number, timestamp: number): boolean {
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
