import type { eventWithTime, mutationCallbackParam } from '@rrweb/types'
import { INCREMENTAL_SNAPSHOT_EVENT_TYPE, MUTATION_SOURCE_TYPE } from './sessionrecording-utils'
import type { rrwebRecord } from './types/rrweb'

import { clampToRange } from '../../utils/number-utils'

export class MutationRateLimiter {
    private _bucketSize = 100
    private _refillRate = 10
    private _mutationBuckets: Record<string, number> = {}
    private _loggedTracker: Record<string, boolean> = {}

    constructor(
        private readonly _rrweb: rrwebRecord,
        private readonly _options: {
            bucketSize?: number
            refillRate?: number
            onBlockedNode?: (id: number, node: Node | null) => void
        } = {}
    ) {
        this._refillRate = clampToRange(
            this._options.refillRate ?? this._refillRate,
            0,
            100,
            'mutation throttling refill rate'
        )
        this._bucketSize = clampToRange(
            this._options.bucketSize ?? this._bucketSize,
            0,
            100,
            'mutation throttling bucket size'
        )
        setInterval(() => {
            this._refillBuckets()
        }, 1000)
    }

    private _refillBuckets = () => {
        Object.keys(this._mutationBuckets).forEach((key) => {
            this._mutationBuckets[key] = this._mutationBuckets[key] + this._refillRate

            if (this._mutationBuckets[key] >= this._bucketSize) {
                delete this._mutationBuckets[key]
            }
        })
    }

    private _getNodeOrRelevantParent = (id: number): [number, Node | null] => {
        // For some nodes we know they are part of a larger tree such as an SVG.
        // For those we want to block the entire node, not just the specific attribute

        const node = this._rrweb.mirror.getNode(id)

        // Check if the node is an Element and then find the closest parent that is an SVG
        if (node?.nodeName !== 'svg' && node instanceof Element) {
            const closestSVG = node.closest('svg')

            if (closestSVG) {
                return [this._rrweb.mirror.getId(closestSVG), closestSVG]
            }
        }

        return [id, node]
    }

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
            // Most problematic mutations come from attrs where the style or minor properties are changed rapidly
            data.attributes = data.attributes.filter((attr) => {
                const [nodeId, node] = this._getNodeOrRelevantParent(attr.id)

                if (this._mutationBuckets[nodeId] === 0) {
                    return false
                }

                this._mutationBuckets[nodeId] = this._mutationBuckets[nodeId] ?? this._bucketSize
                this._mutationBuckets[nodeId] = Math.max(this._mutationBuckets[nodeId] - 1, 0)

                if (this._mutationBuckets[nodeId] === 0) {
                    if (!this._loggedTracker[nodeId]) {
                        this._loggedTracker[nodeId] = true
                        this._options.onBlockedNode?.(nodeId, node)
                    }
                }

                return attr
            })
        }

        // Check if every part of the mutation is empty in which case there is nothing to do
        const mutationCount = this._numberOfChanges(data)

        if (mutationCount === 0 && initialMutationCount !== mutationCount) {
            // If we have modified the mutation count and the remaining count is 0, then we don't need the event.
            return
        }
        return event
    }
}
