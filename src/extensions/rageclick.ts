// Naive rage click implementation: If mouse has not moved than RAGE_CLICK_THRESHOLD_PX
// over RAGE_CLICK_CLICK_COUNT clicks with max RAGE_CLICK_TIMEOUT_MS between clicks, it's
// counted as a rage click
import { PostHogLib } from '../posthog-core'

const RAGE_CLICK_THRESHOLD_PX = 30
const RAGE_CLICK_TIMEOUT_MS = 1000
const RAGE_CLICK_CLICK_COUNT = 3

export default class RageClick {
    instance: PostHogLib
    clicks: { x: number; y: number; timestamp: number }[]
    enabled: boolean

    constructor(instance: PostHogLib, enabled = instance.get_config('rageclick')) {
        this.clicks = []
        this.instance = instance
        this.enabled = enabled
    }

    click(x: number, y: number, timestamp: number) {
        if (!this.enabled) {
            return
        }

        const lastClick = this.clicks[this.clicks.length - 1]
        if (
            lastClick &&
            Math.abs(x - lastClick.x) + Math.abs(y - lastClick.y) < RAGE_CLICK_THRESHOLD_PX &&
            timestamp - lastClick.timestamp < RAGE_CLICK_TIMEOUT_MS
        ) {
            this.clicks.push({ x, y, timestamp })

            if (this.clicks.length === RAGE_CLICK_CLICK_COUNT) {
                this.instance.capture('$rageclick')
            }
        } else {
            this.clicks = [{ x, y, timestamp }]
        }
    }
}
