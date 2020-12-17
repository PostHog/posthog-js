const RAGE_CLICK_THRESHOLD = 30
const RAGE_CLICK_TIMEOUT_MS = 1000
const RAGE_CLICK_CLICK_COUNT = 3

export default class RageClick {
    constructor(instance, enabled = instance.get_config('rageclick')) {
        this.clicks = []
        this.instance = instance
        this.enabled = enabled
    }

    click(x, y, timestamp) {
        if (!this.enabled) {
            return
        }

        const lastClick = this.clicks[this.clicks.length - 1]
        if (
            lastClick &&
            Math.abs(x - lastClick.x) + Math.abs(y - lastClick.y) < RAGE_CLICK_THRESHOLD &&
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
