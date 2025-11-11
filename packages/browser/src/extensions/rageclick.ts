// Naive rage click implementation: If mouse has not moved further than thresholdPx
// over clickCount clicks with max timeoutMs between clicks, it's
// counted as a rage click

import { isObject } from '@posthog/core'
import { RageclickConfig } from '../types'

const DEFAULT_THRESHOLD_PX = 30
const DEFAULT_TIMEOUT_MS = 1000
const DEFAULT_CLICK_COUNT = 3

export default class RageClick {
    clicks: { x: number; y: number; timestamp: number }[]

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
    }

    isRageClick(x: number, y: number, timestamp: number): boolean {
        if (this.disabled) {
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
