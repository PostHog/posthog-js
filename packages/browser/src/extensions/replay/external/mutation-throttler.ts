import type { eventWithTime, mutationCallbackParam } from '../types/rrweb-types'
import {
    INCREMENTAL_SNAPSHOT_EVENT_TYPE,
    MUTATION_SOURCE_TYPE,
    estimateCompressedEventSize,
} from './sessionrecording-utils'
import type { rrwebRecord } from '../types/rrweb'
import { BucketedRateLimiter, isNumber } from '@posthog/core'
import { logger } from '@posthog/browser-common/utils/logger'

export const DEFAULT_MUTATION_BYTES_REFILL_RATE = 25 * 1024
export const DEFAULT_MUTATION_RESYNC_INTERVAL_MS = 5 * 60 * 1000

// An `adds` payload this large is a whole subtree being re-serialized, not an
// ordinary DOM change. Well above what a virtualized list or a calendar grid
// produces, so ordinary churn never reaches the repeat guard below.
export const DEFAULT_OVERSIZED_ADD_BYTES = 1024 * 1024
// Oversized adds allowed before repeats start being dropped. One-off large
// subtree adds (a route change, a lazily mounted widget) stay in the recording;
// a rebuild loop stops after it has spent them.
export const DEFAULT_OVERSIZED_ADD_BUDGET = 3

const numberOr = (value: number | undefined, fallback: number, min: number): number =>
    isNumber(value) && Number.isFinite(value) && value >= min ? value : fallback

export class MutationThrottler {
    private _loggedTracker: Record<string, boolean> = {}
    private _rateLimiter: BucketedRateLimiter<number>
    private _bytesBucketSize: number
    private _bytesRefillRate: number
    private _byteBudgetDisabled: boolean
    private _byteTokens: number
    private _lastByteRefill: number = Date.now()
    private _resyncIntervalMs: number
    private _resyncTimer: ReturnType<typeof setTimeout> | undefined
    private _lastResyncAt = -Infinity
    private _oversizedAddBytes: number
    private _oversizedAddBudgetSize: number
    private _oversizedAddTokens: number
    private _lastOversizedAddRefill: number = Date.now()

    constructor(
        private readonly _rrweb: rrwebRecord,
        private readonly _options: {
            bucketSize?: number
            refillRate?: number
            bytesBucketSize?: number
            bytesRefillRate?: number
            oversizedAddBytes?: number
            oversizedAddBudget?: number
            resyncIntervalMs?: number
            onBlockedNode?: (id: number, node: Node | null) => void
            onDroppedAttributeMutations?: (count: number) => void
            onDroppedOversizedMutation?: (bytes: number) => void
            requestFullSnapshot?: () => void
        } = {}
    ) {
        this._rateLimiter = new BucketedRateLimiter({
            bucketSize: this._options.bucketSize ?? 100,
            refillRate: this._options.refillRate ?? 10,
            refillInterval: 1000, // one second
            _onBucketRateLimited: this._onNodeRateLimited,
            _logger: logger,
        })
        // 0 = disabled: the byte budget is opt-in until a remote-config rollout can ramp it
        this._bytesBucketSize = this._options.bytesBucketSize ?? 0
        this._bytesRefillRate = this._options.bytesRefillRate ?? DEFAULT_MUTATION_BYTES_REFILL_RATE
        this._byteBudgetDisabled = !Number.isFinite(this._bytesBucketSize) || this._bytesBucketSize <= 0
        this._byteTokens = this._bytesBucketSize
        this._oversizedAddBytes = numberOr(this._options.oversizedAddBytes, DEFAULT_OVERSIZED_ADD_BYTES, 1)
        this._oversizedAddBudgetSize = numberOr(this._options.oversizedAddBudget, DEFAULT_OVERSIZED_ADD_BUDGET, 0)
        this._oversizedAddTokens = this._oversizedAddBudgetSize
        // guard against 0 (the "scheduled snapshots disabled" config value) and other
        // non-positive values: a zero cooldown would take a full snapshot per dropped mutation
        this._resyncIntervalMs = numberOr(this._options.resyncIntervalMs, DEFAULT_MUTATION_RESYNC_INTERVAL_MS, 1)
    }

    private _refillByteBudget = () => {
        const now = Date.now()
        const elapsedMs = now - this._lastByteRefill
        if (elapsedMs <= 0) {
            this._lastByteRefill = now
            return
        }
        this._byteTokens = Math.min(
            this._bytesBucketSize,
            this._byteTokens + (elapsedMs / 1000) * this._bytesRefillRate
        )
        this._lastByteRefill = now
    }

    // One token back per resync interval, so a page that rebuilds a big subtree
    // forever keeps paying for at most one of those payloads per interval.
    private _refillOversizedAddBudget = () => {
        const now = Date.now()
        const intervals = Math.floor((now - this._lastOversizedAddRefill) / this._resyncIntervalMs)
        if (intervals <= 0) {
            return
        }
        this._oversizedAddTokens = Math.min(this._oversizedAddBudgetSize, this._oversizedAddTokens + intervals)
        this._lastOversizedAddRefill += intervals * this._resyncIntervalMs
    }

    private _onNodeRateLimited = (key: number) => {
        if (!this._loggedTracker[key]) {
            this._loggedTracker[key] = true
            const node = this._getNode(key)
            this._options.onBlockedNode?.(key, node)
        }
    }

    private _getNodeOrRelevantParent = (id: number): [number, Node | null] => {
        // For some nodes we know they are part of a larger tree such as an SVG.
        // For those we want to block the entire node, not just the specific attribute

        const node = this._getNode(id)

        // Check if the node is an Element and then find the closest parent that is an SVG
        if (node?.nodeName !== 'svg' && node instanceof Element) {
            const closestSVG = node.closest('svg')

            if (closestSVG) {
                return [this._rrweb.mirror.getId(closestSVG), closestSVG]
            }
        }

        return [id, node]
    }

    private _getNode = (id: number) => this._rrweb.mirror.getNode(id)

    private _numberOfChanges = (data: Partial<mutationCallbackParam>) => {
        return (
            (data.removes?.length ?? 0) +
            (data.attributes?.length ?? 0) +
            (data.texts?.length ?? 0) +
            (data.adds?.length ?? 0)
        )
    }

    public throttleMutations = (event: eventWithTime) => {
        if (event.type !== INCREMENTAL_SNAPSHOT_EVENT_TYPE || event.data.source !== MUTATION_SOURCE_TYPE) {
            return event
        }

        const data = event.data as Partial<mutationCallbackParam>
        const initialMutationCount = this._numberOfChanges(data)

        if (data.attributes) {
            const beforeCount = data.attributes.length
            // Most problematic mutations come from attrs where the style or minor properties are changed rapidly
            data.attributes = data.attributes.filter((attr) => {
                const [nodeId] = this._getNodeOrRelevantParent(attr.id)

                const isRateLimited = this._rateLimiter.consumeRateLimit(nodeId)

                if (isRateLimited) {
                    return false
                }

                return attr
            })

            // A dropped attribute mutation (e.g. the class or style that hides an outgoing
            // subtree) never reaches the player, which then shows DOM that left the live page.
            // Report the drop so the recorder can count how often that happens.
            const droppedCount = beforeCount - data.attributes.length
            if (droppedCount > 0) {
                this._options.onDroppedAttributeMutations?.(droppedCount)
            }
        }

        // Check if every part of the mutation is empty in which case there is nothing to do
        const mutationCount = this._numberOfChanges(data)

        if (mutationCount === 0 && initialMutationCount !== mutationCount) {
            // If we have modified the mutation count and the remaining count is 0, then we don't need the event.
            return
        }

        if (this._byteBudgetDisabled) {
            // With the byte budget off nothing bounds a page that re-creates a large
            // same-origin subtree - an embedded viewer's iframe, a heavy widget - which
            // re-serializes all of it on every rebuild, then stringifies and compresses
            // the result. Drop only the repeats, so a one-off large add still reaches
            // the player. The byte budget subsumes this when it is on, and measuring
            // the payload twice would itself cost a walk of the added subtree.
            const oversizedAddBytes = this._repeatedOversizedAddBytes(data)
            if (oversizedAddBytes > 0) {
                this._options.onDroppedOversizedMutation?.(oversizedAddBytes)
                this._scheduleResync()
                return
            }
            return event
        }

        this._refillByteBudget()
        const eventBytes = estimateCompressedEventSize(event)
        if (eventBytes > this._byteTokens) {
            this._options.onDroppedOversizedMutation?.(eventBytes)
            this._scheduleResync()
            return
        }
        this._byteTokens -= eventBytes

        return event
    }

    // Bytes in an `adds` payload large enough to be a whole subtree re-serialized,
    // once the budget for those has run out. 0 when this batch is within budget.
    private _repeatedOversizedAddBytes = (data: Partial<mutationCallbackParam>): number => {
        if (!data.adds?.length) {
            return 0
        }
        const addsBytes = estimateCompressedEventSize(data.adds)
        if (addsBytes <= this._oversizedAddBytes) {
            return 0
        }
        this._refillOversizedAddBudget()
        if (this._oversizedAddTokens <= 0) {
            return addsBytes
        }
        this._oversizedAddTokens -= 1
        return 0
    }

    // A dropped mutation leaves the player's DOM stale until the next full snapshot. Ask for
    // one, at most one per resync interval: re-serializing the whole DOM more often costs more
    // than the mutations being dropped. The timer (not the next passing mutation) delivers the
    // resync even when the page goes quiet right after a drop.
    private _scheduleResync = () => {
        if (this._resyncTimer) {
            return
        }
        const delay = Math.max(0, this._resyncIntervalMs - (Date.now() - this._lastResyncAt))
        this._resyncTimer = setTimeout(() => {
            this._resyncTimer = undefined
            this._lastResyncAt = Date.now()
            this._options.requestFullSnapshot?.()
        }, delay)
    }

    // Called by the recorder on every full snapshot. Only clears per-node state: full snapshots
    // renumber rrweb nodes, but happen mid-session, so refilling the byte budget here would let
    // each resync hand back a fresh bucket. The budget refills only in stop().
    public reset() {
        this._loggedTracker = {}
        if (this._resyncTimer) {
            clearTimeout(this._resyncTimer)
            this._resyncTimer = undefined
        }
        this._lastResyncAt = Date.now()
    }

    public stop() {
        this._rateLimiter.stop()
        this.reset()
        this._byteTokens = this._bytesBucketSize
        this._lastByteRefill = Date.now()
        this._oversizedAddTokens = this._oversizedAddBudgetSize
        this._lastOversizedAddRefill = Date.now()
        this._lastResyncAt = -Infinity
    }
}
