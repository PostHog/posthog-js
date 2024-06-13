import type { eventWithTime, mutationCallbackParam } from '@rrweb/types'
import { INCREMENTAL_SNAPSHOT_EVENT_TYPE, MUTATION_SOURCE_TYPE, rrwebRecord } from './sessionrecording-utils'

export class MutationRateLimiter {
    private bucketSize = 100
    private refillRate = 10
    private mutationBuckets: Record<string, number> = {}
    private loggedTracker: Record<string, boolean> = {}

    constructor(
        private readonly rrweb: rrwebRecord,
        private readonly options: {
            bucketSize?: number
            refillRate?: number
            onBlockedNode?: (id: number, node: Node | null) => void
        } = {}
    ) {
        this.refillRate = this.options.refillRate ?? this.refillRate
        this.bucketSize = this.options.bucketSize ?? this.bucketSize
        setInterval(() => {
            this.refillBuckets()
        }, 1000)
    }

    private refillBuckets = () => {
        Object.keys(this.mutationBuckets).forEach((key) => {
            this.mutationBuckets[key] = this.mutationBuckets[key] + this.refillRate

            if (this.mutationBuckets[key] >= this.bucketSize) {
                delete this.mutationBuckets[key]
            }
        })
    }

    private getNodeOrRelevantParent = (id: number): [number, Node | null] => {
        // For some nodes we know they are part of a larger tree such as an SVG.
        // For those we want to block the entire node, not just the specific attribute

        const node = this.rrweb.mirror.getNode(id)

        // Check if the node is an Element and then find the closest parent that is an SVG
        if (node?.nodeName !== 'svg' && node instanceof Element) {
            const closestSVG = node.closest('svg')

            if (closestSVG) {
                return [this.rrweb.mirror.getId(closestSVG), closestSVG]
            }
        }

        return [id, node]
    }

    private numberOfChanges = (data: Partial<mutationCallbackParam>) => {
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
        const initialMutationCount = this.numberOfChanges(data)

        if (data.attributes) {
            // Most problematic mutations come from attrs where the style or minor properties are changed rapidly
            data.attributes = data.attributes.filter((attr) => {
                const [nodeId, node] = this.getNodeOrRelevantParent(attr.id)

                if (this.mutationBuckets[nodeId] === 0) {
                    return false
                }

                this.mutationBuckets[nodeId] = this.mutationBuckets[nodeId] ?? this.bucketSize
                this.mutationBuckets[nodeId] = Math.max(this.mutationBuckets[nodeId] - 1, 0)

                if (this.mutationBuckets[nodeId] === 0) {
                    if (!this.loggedTracker[nodeId]) {
                        this.loggedTracker[nodeId] = true
                        this.options.onBlockedNode?.(nodeId, node)
                    }
                }

                return attr
            })
        }

        // Check if every part of the mutation is empty in which case there is nothing to do
        const mutationCount = this.numberOfChanges(data)

        if (mutationCount === 0 && initialMutationCount !== mutationCount) {
            // If we have modified the mutation count and the remaining count is 0, then we don't need the event.
            return
        }
        return event
    }
}
