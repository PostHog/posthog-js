// Naive rage click implementation: If mouse has not moved further than RAGE_CLICK_THRESHOLD_PX
// over RAGE_CLICK_CLICK_COUNT clicks with max RAGE_CLICK_TIMEOUT_MS between clicks, it's
// counted as a rage click

const RAGE_CLICK_THRESHOLD_PX = 30
const RAGE_CLICK_TIMEOUT_MS = 1000
const RAGE_CLICK_CLICK_COUNT = 3

export default class RageClick {
    clicks: { x: number; y: number; timestamp: number }[]

    constructor() {
        this.clicks = []
    }

    isRageClick(x: number, y: number, timestamp: number): boolean {
        const lastClick = this.clicks[this.clicks.length - 1]
        if (
            lastClick &&
            Math.abs(x - lastClick.x) + Math.abs(y - lastClick.y) < RAGE_CLICK_THRESHOLD_PX &&
            timestamp - lastClick.timestamp < RAGE_CLICK_TIMEOUT_MS
        ) {
            this.clicks.push({ x, y, timestamp })

            if (this.clicks.length === RAGE_CLICK_CLICK_COUNT) {
                return true
            }
        } else {
            this.clicks = [{ x, y, timestamp }]
        }

        return false
    }
}
