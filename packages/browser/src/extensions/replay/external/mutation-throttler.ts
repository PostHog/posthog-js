import type { eventWithTime, mutationCallbackParam } from '../types/rrweb-types'
import { INCREMENTAL_SNAPSHOT_EVENT_TYPE, MUTATION_SOURCE_TYPE, estimateSize } from './sessionrecording-utils'
import type { rrwebRecord } from '../types/rrweb'
import { BucketedRateLimiter } from '@posthog/core'
import { logger } from '@posthog/browser-common/utils/logger'

export const DEFAULT_MUTATION_BYTES_BUCKET_SIZE = 1024 * 1024
export const DEFAULT_MUTATION_BYTES_REFILL_RATE = 25 * 1024

export class MutationThrottler {
    private _loggedTracker: Record<string, boolean> = {}
    private _rateLimiter: BucketedRateLimiter<number>
    private _bytesBucketSize: number
    private _bytesRefillRate: number
    private _byteTokens: number
    private _lastByteRefill: number = Date.now()
    private _snapshotPendingAfterDrop = false

    constructor(
        private readonly _rrweb: rrwebRecord,
        private readonly _options: {
            bucketSize?: number
            refillRate?: number
            bytesBucketSize?: number
            bytesRefillRate?: number
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
        this._bytesBucketSize = this._options.bytesBucketSize ?? DEFAULT_MUTATION_BYTES_BUCKET_SIZE
        this._bytesRefillRate = this._options.bytesRefillRate ?? DEFAULT_MUTATION_BYTES_REFILL_RATE
        this._byteTokens = this._bytesBucketSize
    }

    private _refillByteBudget = () => {
        const now = Date.now()
        const elapsedMs = now - this._lastByteRefill
        if (elapsedMs <= 0) {
            return
        }
        this._byteTokens = Math.min(
            this._bytesBucketSize,
            this._byteTokens + (elapsedMs / 1000) * this._bytesRefillRate
        )
        this._lastByteRefill = now
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

        this._refillByteBudget()
        const eventBytes = estimateSize(event)
        if (eventBytes > this._byteTokens) {
            this._snapshotPendingAfterDrop = true
            this._options.onDroppedOversizedMutation?.(eventBytes)
            return
        }
        this._byteTokens -= eventBytes

        if (this._snapshotPendingAfterDrop) {
            this._snapshotPendingAfterDrop = false
            this._options.requestFullSnapshot?.()
        }

        return event
    }

    public reset() {
        this._loggedTracker = {}
        this._byteTokens = this._bytesBucketSize
        this._lastByteRefill = Date.now()
        this._snapshotPendingAfterDrop = false
    }

    public stop() {
        this._rateLimiter.stop()
        this.reset()
    }
}
