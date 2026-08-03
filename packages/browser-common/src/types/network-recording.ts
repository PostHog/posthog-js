import type { CapturedNetworkRequest, InitiatorType } from '@posthog/types'

export type NetworkRecordOptions = {
    initiatorTypes?: InitiatorType[]
    maskRequestFn?: (data: CapturedNetworkRequest) => CapturedNetworkRequest | undefined
    recordHeaders?: boolean | { request: boolean; response: boolean }
    recordBody?: boolean | string[] | { request: boolean | string[]; response: boolean | string[] }
    recordInitialRequests?: boolean
    /**
     * whether to record PerformanceEntry events for network requests
     */
    recordPerformance?: boolean
    /**
     * the PerformanceObserver will only observe these entry types
     */
    performanceEntryTypeToObserve: string[]
    /**
     * the maximum size of the request/response body to record
     * NB this will be at most 1MB even if set larger
     */
    payloadSizeLimitBytes: number
    /**
     * when true, read bodies through a streaming reader that stops at payloadSizeLimitBytes
     * instead of buffering the whole body and then enforcing the limit. Reads only a clone of
     * the body, so it never consumes the stream the page itself reads.
     * @default false
     */
    streamNetworkBody?: boolean
    /**
     * some domains we should never record the payload
     * for example other companies session replay ingestion payloads aren't super useful but are gigantic
     * if this isn't provided we use a default list
     * if this is provided - we add the provided list to the default list
     * i.e. we never record the payloads on the default deny list
     */
    payloadHostDenyList?: string[]
}
