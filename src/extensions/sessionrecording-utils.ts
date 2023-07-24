import type {
    KeepIframeSrcFn,
    RecordPlugin,
    SamplingStrategy,
    blockClass,
    eventWithTime,
    hooksParam,
    listenerHandler,
    maskTextClass,
    pluginEvent,
    mutationCallbackParam,
} from '@rrweb/types'
import type { Mirror, MaskInputOptions, MaskInputFn, MaskTextFn, SlimDOMOptions, DataURLOptions } from 'rrweb-snapshot'

export const replacementImageURI =
    'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJibGFjayIvPgo8cGF0aCBkPSJNOCAwSDE2TDAgMTZWOEw4IDBaIiBmaWxsPSIjMkQyRDJEIi8+CjxwYXRoIGQ9Ik0xNiA4VjE2SDhMMTYgOFoiIGZpbGw9IiMyRDJEMkQiLz4KPC9zdmc+Cg=='

export const FULL_SNAPSHOT_EVENT_TYPE = 2
export const META_EVENT_TYPE = 4
export const INCREMENTAL_SNAPSHOT_EVENT_TYPE = 3
export const PLUGIN_EVENT_TYPE = 6
export const MUTATION_SOURCE_TYPE = 0

export const MAX_MESSAGE_SIZE = 5000000 // ~5mb

export type rrwebRecord = {
    (options: recordOptions<eventWithTime>): listenerHandler
    addCustomEvent: (tag: string, payload: any) => void
    takeFullSnapshot: () => void
    mirror: Mirror
}

export declare type recordOptions<T> = {
    emit?: (e: T, isCheckout?: boolean) => void
    checkoutEveryNth?: number
    checkoutEveryNms?: number
    blockClass?: blockClass
    blockSelector?: string
    ignoreClass?: string
    maskTextClass?: maskTextClass
    maskTextSelector?: string
    maskAllInputs?: boolean
    maskInputOptions?: MaskInputOptions
    maskInputFn?: MaskInputFn
    maskTextFn?: MaskTextFn
    slimDOMOptions?: SlimDOMOptions | 'all' | true
    ignoreCSSAttributes?: Set<string>
    inlineStylesheet?: boolean
    hooks?: hooksParam
    // packFn?: PackFn
    sampling?: SamplingStrategy
    dataURLOptions?: DataURLOptions
    recordCanvas?: boolean
    recordCrossOriginIframes?: boolean
    recordAfter?: 'DOMContentLoaded' | 'load'
    userTriggeredOnInput?: boolean
    collectFonts?: boolean
    inlineImages?: boolean
    plugins?: RecordPlugin[]
    mousemoveWait?: number
    keepIframeSrcFn?: KeepIframeSrcFn
    // errorHandler?: ErrorHandler
}

/*
 * Check whether a data payload is nearing 5mb. If it is, it checks the data for
 * data URIs (the likely culprit for large payloads). If it finds data URIs, it either replaces
 * it with a generic image (if it's an image) or removes it.
 * @data {object} the rr-web data object
 * @returns {object} the rr-web data object with data uris filtered out
 */
export function ensureMaxMessageSize(data: eventWithTime): { event: eventWithTime; size: number } {
    let stringifiedData = JSON.stringify(data)
    // Note: with compression, this limit may be able to be increased
    // but we're assuming most of the size is from a data uri which
    // is unlikely to be compressed further
    if (stringifiedData.length > MAX_MESSAGE_SIZE) {
        // Regex that matches the pattern for a dataURI with the shape 'data:{mime type};{encoding},{data}'. It:
        // 1) Checks if the pattern starts with 'data:' (potentially, not at the start of the string)
        // 2) Extracts the mime type of the data uri in the first group
        // 3) Determines when the data URI ends.Depending on if it's used in the src tag or css, it can end with a ) or "
        const dataURIRegex = /data:([\w\/\-\.]+);(\w+),([^)"]*)/gim
        const matches = stringifiedData.matchAll(dataURIRegex)
        for (const match of matches) {
            if (match[1].toLocaleLowerCase().slice(0, 6) === 'image/') {
                stringifiedData = stringifiedData.replace(match[0], replacementImageURI)
            } else {
                stringifiedData = stringifiedData.replace(match[0], '')
            }
        }
    }
    return { event: JSON.parse(stringifiedData), size: stringifiedData.length }
}

export const CONSOLE_LOG_PLUGIN_NAME = 'rrweb/console@1' // The name of the rr-web plugin that emits console logs

// Console logs can be really large. This function truncates large logs
// It's a simple function that just truncates long strings.
// TODO: Ideally this function would have better handling of objects + lists,
// so they could still be rendered in a pretty way after truncation.
export function truncateLargeConsoleLogs(_event: eventWithTime) {
    const event = _event as pluginEvent<{ payload: string[] }>

    const MAX_STRING_SIZE = 2000 // Maximum number of characters allowed in a string
    const MAX_STRINGS_PER_LOG = 10 // A log can consist of multiple strings (e.g. consol.log('string1', 'string2'))

    if (
        event &&
        typeof event === 'object' &&
        event.type === PLUGIN_EVENT_TYPE &&
        typeof event.data === 'object' &&
        event.data.plugin === CONSOLE_LOG_PLUGIN_NAME
    ) {
        // Note: event.data.payload.payload comes from rr-web, and is an array of strings
        if (event.data.payload.payload.length > MAX_STRINGS_PER_LOG) {
            event.data.payload.payload = event.data.payload.payload.slice(0, MAX_STRINGS_PER_LOG)
            event.data.payload.payload.push('...[truncated]')
        }
        const updatedPayload = []
        for (let i = 0; i < event.data.payload.payload.length; i++) {
            if (
                event.data.payload.payload[i] && // Value can be null
                event.data.payload.payload[i].length > MAX_STRING_SIZE
            ) {
                updatedPayload.push(event.data.payload.payload[i].slice(0, MAX_STRING_SIZE) + '...[truncated]')
            } else {
                updatedPayload.push(event.data.payload.payload[i])
            }
        }
        event.data.payload.payload = updatedPayload
        // Return original type
        return _event
    }
    return _event
}

export class MutationRateLimiter {
    mutationBuckets: Record<string, number> = {}
    blockedNodes: Record<string, boolean> = {}

    constructor(
        private readonly rrweb: rrwebRecord,
        private readonly options: {
            mutationLimit?: number
            leakRate?: number
            onBlockedNode?: (id: number, node: Node | null) => void
        }
    ) {
        setInterval(() => {
            this.leakBuckets()
        }, 1000)
    }

    private leakBuckets = () => {
        Object.keys(this.mutationBuckets).forEach((key) => {
            this.mutationBuckets[key] = Math.max(this.mutationBuckets[key] - (this.options.leakRate ?? 10), 0)

            if (this.mutationBuckets[key] === 0) {
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

    public throttleMutations = (event: eventWithTime) => {
        if (event.type !== INCREMENTAL_SNAPSHOT_EVENT_TYPE || event.data.source !== MUTATION_SOURCE_TYPE) {
            return event
        }

        const data = event.data as mutationCallbackParam

        // Most problematic mutations come from attrs where the style or minor properties are changed rapidly
        data.attributes = data.attributes.filter((attr) => {
            const [nodeId, node] = this.getNodeOrRelevantParent(attr.id)

            if (this.blockedNodes[nodeId]) {
                return false
            }

            this.mutationBuckets[nodeId] = this.mutationBuckets[nodeId] ? this.mutationBuckets[nodeId] + 1 : 1

            if (this.mutationBuckets[nodeId] > (this.options.mutationLimit ?? 50)) {
                this.blockedNodes[nodeId] = true
                this.options.onBlockedNode?.(nodeId, node)
            }

            return attr
        })

        // Clean up after ourselves when the nodes get removed
        data.removes.forEach((attr) => {
            if (this.blockedNodes[attr.id]) {
                return
            }
        })

        // Check if every part of the mutation is empty in which case there is nothing to do
        const noMutationsLeft = [data.attributes, data.removes, data.texts, data.adds].every((data) => !data.length)

        if (noMutationsLeft) {
            return
        }
        return event
    }
}
