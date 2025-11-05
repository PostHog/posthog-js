/// <reference lib="dom" />

// rrweb/network@1 code starts
// most of what is below here will be removed when rrweb release their code for this
// see https://github.com/rrweb-io/rrweb/pull/1105

// NB adopted from https://github.com/rrweb-io/rrweb/pull/1105 which looks like it will be accepted into rrweb
// however, in the PR, it throws when the performance observer data is not available
// and assumes it is running in a browser with the Request API (i.e. not IE11)
// copying here so that we can use it before rrweb adopt it

import type { IWindow, listenerHandler, RecordPlugin } from '../types/rrweb-types'
import { CapturedNetworkRequest, Headers, InitiatorType, NetworkRecordOptions } from '../../../types'
import { isArray, isBoolean, isFormData, isNull, isNullish, isString, isUndefined, isObject } from '@posthog/core'
import { isDocument } from '../../../utils/type-utils'
import { createLogger } from '../../../utils/logger'
import { formDataToQuery } from '../../../utils/request-utils'
import { patch } from '../rrweb-plugins/patch'
import { isHostOnDenyList } from '../../../extensions/replay/external/denylist'
import { defaultNetworkOptions } from './config'

const logger = createLogger('[Recorder]')

export type NetworkData = {
    requests: CapturedNetworkRequest[]
    isInitial?: boolean
}

type networkCallback = (data: NetworkData) => void

const isNavigationTiming = (entry: PerformanceEntry): entry is PerformanceNavigationTiming =>
    entry.entryType === 'navigation'
const isResourceTiming = (entry: PerformanceEntry): entry is PerformanceResourceTiming => entry.entryType === 'resource'

type ObservedPerformanceEntry = (PerformanceNavigationTiming | PerformanceResourceTiming) & {
    responseStatus?: number
}

export function findLast<T>(array: Array<T>, predicate: (value: T) => boolean): T | undefined {
    const length = array.length
    for (let i = length - 1; i >= 0; i -= 1) {
        if (predicate(array[i])) {
            return array[i]
        }
    }
    return undefined
}

function initPerformanceObserver(cb: networkCallback, win: IWindow, options: Required<NetworkRecordOptions>) {
    // if we are only observing timings then we could have a single observer for all types, with buffer true,
    // but we are going to filter by initiatorType _if we are wrapping fetch and xhr as the wrapped functions
    // will deal with those.
    // so we have a block which captures requests from before fetch/xhr is wrapped
    // these are marked `isInitial` so playback can display them differently if needed
    // they will never have method/status/headers/body because they are pre-wrapping that provides that
    if (options.recordInitialRequests) {
        const initialPerformanceEntries = win.performance
            .getEntries()
            .filter(
                (entry): entry is ObservedPerformanceEntry =>
                    isNavigationTiming(entry) ||
                    (isResourceTiming(entry) && options.initiatorTypes.includes(entry.initiatorType as InitiatorType))
            )
        cb({
            requests: initialPerformanceEntries.flatMap((entry) =>
                prepareRequest({ entry, method: undefined, status: undefined, networkRequest: {}, isInitial: true })
            ),
            isInitial: true,
        })
    }
    const observer = new win.PerformanceObserver((entries) => {
        // if recordBody or recordHeaders is true then we don't want to record fetch or xhr here
        // as the wrapped functions will do that. Otherwise, this filter becomes a noop
        // because we do want to record them here
        const wrappedInitiatorFilter = (entry: ObservedPerformanceEntry) =>
            options.recordBody || options.recordHeaders
                ? entry.initiatorType !== 'xmlhttprequest' && entry.initiatorType !== 'fetch'
                : true

        const performanceEntries = entries.getEntries().filter(
            (entry): entry is ObservedPerformanceEntry =>
                isNavigationTiming(entry) ||
                (isResourceTiming(entry) &&
                    options.initiatorTypes.includes(entry.initiatorType as InitiatorType) &&
                    // TODO if we are _only_ capturing timing we don't want to filter initiator here
                    wrappedInitiatorFilter(entry))
        )

        cb({
            requests: performanceEntries.flatMap((entry) =>
                prepareRequest({ entry, method: undefined, status: undefined, networkRequest: {} })
            ),
        })
    })
    // compat checked earlier
    // eslint-disable-next-line compat/compat
    const entryTypes = PerformanceObserver.supportedEntryTypes.filter((x) =>
        options.performanceEntryTypeToObserve.includes(x)
    )
    // initial records are gathered above, so we don't need to observe and buffer each type separately
    observer.observe({ entryTypes })
    return () => {
        observer.disconnect()
    }
}

function shouldRecordHeaders(type: 'request' | 'response', recordHeaders: NetworkRecordOptions['recordHeaders']) {
    return !!recordHeaders && (isBoolean(recordHeaders) || recordHeaders[type])
}

export function shouldRecordBody({
    type,
    recordBody,
    headers,
    url,
}: {
    type: 'request' | 'response'
    headers: Headers
    url: string | URL | RequestInfo
    recordBody: NetworkRecordOptions['recordBody']
}) {
    function matchesContentType(contentTypes: string[]) {
        const contentTypeHeader = Object.keys(headers).find((key) => key.toLowerCase() === 'content-type')
        const contentType = contentTypeHeader && headers[contentTypeHeader]
        return contentTypes.some((ct) => contentType?.includes(ct))
    }

    /**
     * particularly in canvas applications we see many requests to blob URLs
     * e.g. blob:https://video_url
     * these blob/object URLs are local to the browser, we can never capture that body
     * so we can just return false here
     */
    function isBlobURL(url: string | URL | RequestInfo) {
        try {
            if (typeof url === 'string') {
                return url.startsWith('blob:')
            }
            if (url instanceof URL) {
                return url.protocol === 'blob:'
            }
            if (url instanceof Request) {
                return isBlobURL(url.url)
            }
            return false
        } catch {
            return false
        }
    }
    if (!recordBody) return false
    if (isBlobURL(url)) return false
    if (isBoolean(recordBody)) return true
    if (isArray(recordBody)) return matchesContentType(recordBody)
    const recordBodyType = recordBody[type]
    if (isBoolean(recordBodyType)) return recordBodyType
    return matchesContentType(recordBodyType)
}

async function getRequestPerformanceEntry(
    win: IWindow,
    initiatorType: string,
    url: string,
    start?: number,
    end?: number,
    attempt = 0
): Promise<PerformanceResourceTiming | null> {
    if (attempt > 10) {
        logger.warn('Failed to get performance entry for request', { url, initiatorType })
        return null
    }
    const urlPerformanceEntries = win.performance.getEntriesByName(url) as PerformanceResourceTiming[]
    const performanceEntry = findLast(
        urlPerformanceEntries,
        (entry) =>
            isResourceTiming(entry) &&
            entry.initiatorType === initiatorType &&
            (isUndefined(start) || entry.startTime >= start) &&
            (isUndefined(end) || entry.startTime <= end)
    )
    if (!performanceEntry) {
        await new Promise((resolve) => setTimeout(resolve, 50 * attempt))
        return getRequestPerformanceEntry(win, initiatorType, url, start, end, attempt + 1)
    }
    return performanceEntry
}

/**
 * According to MDN https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/response
 * xhr response is typed as any but can be an ArrayBuffer, a Blob, a Document, a JavaScript object,
 * or a string, depending on the value of XMLHttpRequest.responseType, that contains the response entity body.
 *
 * XHR request body is Document | XMLHttpRequestBodyInit | null | undefined
 */
function _tryReadXHRBody({
    body,
    options,
    url,
}: {
    body: Document | XMLHttpRequestBodyInit | any | null | undefined
    options: NetworkRecordOptions
    url: string | URL | RequestInfo
}): string | null {
    if (isNullish(body)) {
        return null
    }

    const { hostname, isHostDenied } = isHostOnDenyList(url, options)
    if (isHostDenied) {
        return hostname + ' is in deny list'
    }

    if (isString(body)) {
        return body
    }

    if (isDocument(body)) {
        return body.textContent
    }

    if (isFormData(body)) {
        return formDataToQuery(body)
    }

    if (isObject(body)) {
        try {
            return JSON.stringify(body)
        } catch {
            return '[SessionReplay] Failed to stringify response object'
        }
    }

    return '[SessionReplay] Cannot read body of type ' + toString.call(body)
}

function initXhrObserver(cb: networkCallback, win: IWindow, options: Required<NetworkRecordOptions>): listenerHandler {
    if (!options.initiatorTypes.includes('xmlhttprequest')) {
        return () => {
            //
        }
    }
    const recordRequestHeaders = shouldRecordHeaders('request', options.recordHeaders)
    const recordResponseHeaders = shouldRecordHeaders('response', options.recordHeaders)

    const restorePatch = patch(
        win.XMLHttpRequest.prototype,
        'open',
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        (originalOpen: typeof XMLHttpRequest.prototype.open) => {
            return function (
                method: string,
                url: string | URL,
                async = true,
                username?: string | null,
                password?: string | null
            ) {
                // because this function is returned in its actual context `this` _is_ an XMLHttpRequest
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                const xhr = this as XMLHttpRequest

                // check IE earlier than this, we only initialize if Request is present
                // eslint-disable-next-line compat/compat
                const req = new Request(url)
                const networkRequest: Partial<CapturedNetworkRequest> = {}
                let start: number | undefined
                let end: number | undefined

                const requestHeaders: Headers = {}
                const originalSetRequestHeader = xhr.setRequestHeader.bind(xhr)
                xhr.setRequestHeader = (header: string, value: string) => {
                    requestHeaders[header] = value
                    return originalSetRequestHeader(header, value)
                }
                if (recordRequestHeaders) {
                    networkRequest.requestHeaders = requestHeaders
                }

                const originalSend = xhr.send.bind(xhr)
                xhr.send = (body) => {
                    if (
                        shouldRecordBody({
                            type: 'request',
                            headers: requestHeaders,
                            url,
                            recordBody: options.recordBody,
                        })
                    ) {
                        networkRequest.requestBody = _tryReadXHRBody({ body, options, url })
                    }
                    start = win.performance.now()
                    return originalSend(body)
                }

                const readyStateListener = () => {
                    if (xhr.readyState !== xhr.DONE) {
                        return
                    }

                    // Clean up the listener immediately when done to prevent memory leaks
                    xhr.removeEventListener('readystatechange', readyStateListener)

                    end = win.performance.now()
                    const responseHeaders: Headers = {}
                    const rawHeaders = xhr.getAllResponseHeaders()
                    const headers = rawHeaders.trim().split(/[\r\n]+/)
                    headers.forEach((line) => {
                        const parts = line.split(': ')
                        const header = parts.shift()
                        const value = parts.join(': ')
                        if (header) {
                            responseHeaders[header] = value
                        }
                    })
                    if (recordResponseHeaders) {
                        networkRequest.responseHeaders = responseHeaders
                    }
                    if (
                        shouldRecordBody({
                            type: 'response',
                            headers: responseHeaders,
                            url,
                            recordBody: options.recordBody,
                        })
                    ) {
                        networkRequest.responseBody = _tryReadXHRBody({ body: xhr.response, options, url })
                    }
                    getRequestPerformanceEntry(win, 'xmlhttprequest', req.url, start, end)
                        .then((entry) => {
                            const requests = prepareRequest({
                                entry,
                                method: method,
                                status: xhr?.status,
                                networkRequest,
                                start,
                                end,
                                url: url.toString(),
                                initiatorType: 'xmlhttprequest',
                            })
                            cb({ requests })
                        })
                        .catch(() => {
                            //
                        })
                }

                // This is very tricky code, and making it passive won't bring many performance benefits,
                // so let's ignore the rule here.
                // eslint-disable-next-line posthog-js/no-add-event-listener
                xhr.addEventListener('readystatechange', readyStateListener)

                originalOpen.call(xhr, method, url.toString(), async, username, password)
            }
        }
    )
    return () => {
        restorePatch()
    }
}

/**
 *  Check if this PerformanceEntry is either a PerformanceResourceTiming or a PerformanceNavigationTiming
 *  NB PerformanceNavigationTiming extends PerformanceResourceTiming
 *  Here we don't care which interface it implements as both expose `serverTimings`
 */
const exposesServerTiming = (event: PerformanceEntry | null): event is PerformanceResourceTiming =>
    !isNull(event) && (event.entryType === 'navigation' || event.entryType === 'resource')

function prepareRequest({
    entry,
    method,
    status,
    networkRequest,
    isInitial,
    start,
    end,
    url,
    initiatorType,
}: {
    entry: PerformanceResourceTiming | null
    method: string | undefined
    status: number | undefined
    networkRequest: Partial<CapturedNetworkRequest>
    isInitial?: boolean
    start?: number
    end?: number
    // if there is no performance observer entry, we still need to know the url
    url?: string
    // if there is no performance observer entry, we can provide the initiatorType
    initiatorType?: string
}): CapturedNetworkRequest[] {
    start = entry ? entry.startTime : start
    end = entry ? entry.responseEnd : end

    // kudos to sentry javascript sdk for excellent background on why to use Date.now() here
    // https://github.com/getsentry/sentry-javascript/blob/e856e40b6e71a73252e788cd42b5260f81c9c88e/packages/utils/src/time.ts#L70
    // can't start observer if performance.now() is not available
    // eslint-disable-next-line compat/compat
    const timeOrigin = Math.floor(Date.now() - performance.now())
    // clickhouse can't ingest timestamps that are floats
    // (in this case representing fractions of a millisecond we don't care about anyway)
    // use timeOrigin if we really can't gather a start time
    const timestamp = Math.floor(timeOrigin + (start || 0))

    const entryJSON = entry ? entry.toJSON() : { name: url }

    const requests: CapturedNetworkRequest[] = [
        {
            ...entryJSON,
            startTime: isUndefined(start) ? undefined : Math.round(start),
            endTime: isUndefined(end) ? undefined : Math.round(end),
            timeOrigin,
            timestamp,
            method: method,
            initiatorType: initiatorType ? initiatorType : entry ? (entry.initiatorType as InitiatorType) : undefined,
            status,
            requestHeaders: networkRequest.requestHeaders,
            requestBody: networkRequest.requestBody,
            responseHeaders: networkRequest.responseHeaders,
            responseBody: networkRequest.responseBody,
            isInitial,
        },
    ]

    if (exposesServerTiming(entry)) {
        for (const timing of entry.serverTiming || []) {
            requests.push({
                timeOrigin,
                timestamp,
                startTime: Math.round(entry.startTime),
                name: timing.name,
                duration: timing.duration,
                // the spec has a closed list of possible types
                // https://developer.mozilla.org/en-US/docs/Web/API/PerformanceEntry/entryType
                // but, we need to know this was a server timing so that we know to
                // match it to the appropriate navigation or resource timing
                // that matching will have to be on timestamp and $current_url
                entryType: 'serverTiming',
            })
        }
    }

    return requests
}

const contentTypePrefixDenyList = ['video/', 'audio/']

function _checkForCannotReadResponseBody({
    r,
    options,
    url,
}: {
    r: Response
    options: NetworkRecordOptions
    url: string | URL | RequestInfo
}): string | null {
    if (r.headers.get('Transfer-Encoding') === 'chunked') {
        return 'Chunked Transfer-Encoding is not supported'
    }

    // `get` and `has` are case-insensitive
    // but return the header value with the casing that was supplied
    const contentType = r.headers.get('Content-Type')?.toLowerCase()
    const contentTypeIsDenied = contentTypePrefixDenyList.some((prefix) => contentType?.startsWith(prefix))
    if (contentType && contentTypeIsDenied) {
        return `Content-Type ${contentType} is not supported`
    }

    const { hostname, isHostDenied } = isHostOnDenyList(url, options)
    if (isHostDenied) {
        return hostname + ' is in deny list'
    }

    return null
}

function _tryReadBody(r: Request | Response): Promise<string> {
    // there are now already multiple places where we're using Promise...
    // eslint-disable-next-line compat/compat
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => resolve('[SessionReplay] Timeout while trying to read body'), 500)
        try {
            r.clone()
                .text()
                .then(
                    (txt) => resolve(txt),
                    (reason) => reject(reason)
                )
                .finally(() => clearTimeout(timeout))
        } catch {
            clearTimeout(timeout)
            resolve('[SessionReplay] Failed to read body')
        }
    })
}

async function _tryReadRequestBody({
    r,
    options,
    url,
}: {
    r: Request
    options: NetworkRecordOptions
    url: string | URL | RequestInfo
}): Promise<string> {
    const { hostname, isHostDenied } = isHostOnDenyList(url, options)
    if (isHostDenied) {
        return Promise.resolve(hostname + ' is in deny list')
    }

    return _tryReadBody(r)
}

async function _tryReadResponseBody({
    r,
    options,
    url,
}: {
    r: Response
    options: NetworkRecordOptions
    url: string | URL | RequestInfo
}): Promise<string> {
    const cannotReadBodyReason: string | null = _checkForCannotReadResponseBody({ r, options, url })
    if (!isNull(cannotReadBodyReason)) {
        return Promise.resolve(cannotReadBodyReason)
    }

    return _tryReadBody(r)
}

function initFetchObserver(
    cb: networkCallback,
    win: IWindow,
    options: Required<NetworkRecordOptions>
): listenerHandler {
    if (!options.initiatorTypes.includes('fetch')) {
        return () => {
            //
        }
    }
    const recordRequestHeaders = shouldRecordHeaders('request', options.recordHeaders)
    const recordResponseHeaders = shouldRecordHeaders('response', options.recordHeaders)

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const restorePatch = patch(win, 'fetch', (originalFetch: typeof fetch) => {
        return async function (url: URL | RequestInfo, init?: RequestInit | undefined) {
            // check IE earlier than this, we only initialize if Request is present
            // eslint-disable-next-line compat/compat
            const req = new Request(url, init)
            let res: Response | undefined
            const networkRequest: Partial<CapturedNetworkRequest> = {}
            let start: number | undefined
            let end: number | undefined

            try {
                const requestHeaders: Headers = {}
                req.headers.forEach((value: string, header: string | number) => {
                    requestHeaders[header] = value
                })
                if (recordRequestHeaders) {
                    networkRequest.requestHeaders = requestHeaders
                }
                if (
                    shouldRecordBody({
                        type: 'request',
                        headers: requestHeaders,
                        url,
                        recordBody: options.recordBody,
                    })
                ) {
                    networkRequest.requestBody = await _tryReadRequestBody({ r: req, options, url })
                }

                start = win.performance.now()
                res = await originalFetch(req)
                end = win.performance.now()

                const responseHeaders: Headers = {}
                res.headers.forEach((value: string, header: string | number) => {
                    responseHeaders[header] = value
                })
                if (recordResponseHeaders) {
                    networkRequest.responseHeaders = responseHeaders
                }
                if (
                    shouldRecordBody({
                        type: 'response',
                        headers: responseHeaders,
                        url,
                        recordBody: options.recordBody,
                    })
                ) {
                    networkRequest.responseBody = await _tryReadResponseBody({ r: res, options, url })
                }

                return res
            } finally {
                getRequestPerformanceEntry(win, 'fetch', req.url, start, end)
                    .then((entry) => {
                        const requests = prepareRequest({
                            entry,
                            method: req.method,
                            status: res?.status,
                            networkRequest,
                            start,
                            end,
                            url: req.url,
                            initiatorType: 'fetch',
                        })
                        cb({ requests })
                    })
                    .catch(() => {
                        //
                    })
            }
        }
    })
    return () => {
        restorePatch()
    }
}

let initialisedHandler: listenerHandler | null = null

function initNetworkObserver(
    callback: networkCallback,
    win: IWindow, // top window or in an iframe
    options: NetworkRecordOptions
): listenerHandler {
    if (!('performance' in win)) {
        return () => {
            //
        }
    }

    if (initialisedHandler) {
        logger.warn('Network observer already initialised, doing nothing')
        return () => {
            // the first caller should already have this handler and will be responsible for teardown
        }
    }

    const networkOptions = (
        options ? Object.assign({}, defaultNetworkOptions, options) : defaultNetworkOptions
    ) as Required<NetworkRecordOptions>

    const cb: networkCallback = (data) => {
        const requests: CapturedNetworkRequest[] = []
        data.requests.forEach((request) => {
            const maskedRequest = networkOptions.maskRequestFn(request)
            if (maskedRequest) {
                requests.push(maskedRequest)
            }
        })

        if (requests.length > 0) {
            callback({ ...data, requests })
        }
    }
    const performanceObserver = initPerformanceObserver(cb, win, networkOptions)

    // only wrap fetch and xhr if headers or body are being recorded
    let xhrObserver: listenerHandler = () => {}
    let fetchObserver: listenerHandler = () => {}
    if (networkOptions.recordHeaders || networkOptions.recordBody) {
        xhrObserver = initXhrObserver(cb, win, networkOptions)
        fetchObserver = initFetchObserver(cb, win, networkOptions)
    }

    initialisedHandler = () => {
        performanceObserver()
        xhrObserver()
        fetchObserver()
    }
    return initialisedHandler
}

// use the plugin name so that when this functionality is adopted into rrweb
// we can remove this plugin and use the core functionality with the same data
export const NETWORK_PLUGIN_NAME = 'rrweb/network@1'

// TODO how should this be typed?
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export const getRecordNetworkPlugin: (options?: NetworkRecordOptions) => RecordPlugin = (options) => {
    return {
        name: NETWORK_PLUGIN_NAME,
        observer: initNetworkObserver,
        options: options,
    }
}

// rrweb/networ@1 ends
