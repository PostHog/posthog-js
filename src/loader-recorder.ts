import { version } from 'rrweb/package.json'

// Same as loader-globals.ts except includes rrweb2 scripts.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import rrwebRecord from 'rrweb/es/rrweb/packages/rrweb/src/record'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { getRecordConsolePlugin } from 'rrweb/es/rrweb/packages/rrweb/src/plugins/console/record'

// rrweb/network@1 code starts
// most of what is below here will be removed when rrweb release their code for this
// see https://github.com/rrweb-io/rrweb/pull/1105
/// <reference lib="dom" />
// NB adopted from https://github.com/rrweb-io/rrweb/pull/1105 which looks like it will be accepted into rrweb
// however, in the PR, it throws when the performance observer data is not available
// and assumes it is running in a browser with the Request API (i.e. not IE11)
// copying here so that we can use it before rrweb adopt it
import type { IWindow, listenerHandler, RecordPlugin } from '@rrweb/types'
import { CapturedNetworkRequest, Headers, InitiatorType, NetworkRecordOptions } from './types'
import {
    _isArray,
    _isBoolean,
    _isDocument,
    _isFormData,
    _isFunction,
    _isNull,
    _isNullish,
    _isObject,
    _isString,
    _isUndefined,
} from './utils/type-utils'
import { logger } from './utils/logger'
import { window } from './utils/globals'
import { defaultNetworkOptions } from './extensions/replay/config'
import { _formDataToQuery } from './utils/request-utils'

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

// import { patch } from 'rrweb/typings/utils'
// copied from https://github.com/rrweb-io/rrweb/blob/8aea5b00a4dfe5a6f59bd2ae72bb624f45e51e81/packages/rrweb/src/utils.ts#L129
// which was copied from https://github.com/getsentry/sentry-javascript/blob/b2109071975af8bf0316d3b5b38f519bdaf5dc15/packages/utils/src/object.ts
export function patch(
    source: { [key: string]: any },
    name: string,
    replacement: (...args: unknown[]) => unknown
): () => void {
    try {
        if (!(name in source)) {
            return () => {
                //
            }
        }

        const original = source[name] as () => unknown
        const wrapped = replacement(original)

        // Make sure it's a function first, as we need to attach an empty prototype for `defineProperties` to work
        // otherwise it'll throw "TypeError: Object.defineProperties called on non-object"
        if (_isFunction(wrapped)) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            wrapped.prototype = wrapped.prototype || {}
            Object.defineProperties(wrapped, {
                __rrweb_original__: {
                    enumerable: false,
                    value: original,
                },
            })
        }

        source[name] = wrapped

        return () => {
            source[name] = original
        }
    } catch {
        return () => {
            //
        }
        // This can throw if multiple fill happens on a global object like XMLHttpRequest
        // Fixes https://github.com/getsentry/sentry-javascript/issues/2043
    }
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
                prepareRequest(entry, undefined, undefined, {}, true)
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
            requests: performanceEntries.flatMap((entry) => prepareRequest(entry, undefined, undefined, {})),
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
    return !!recordHeaders && (_isBoolean(recordHeaders) || recordHeaders[type])
}

function shouldRecordBody(
    type: 'request' | 'response',
    recordBody: NetworkRecordOptions['recordBody'],
    headers: Headers
) {
    function matchesContentType(contentTypes: string[]) {
        const contentTypeHeader = Object.keys(headers).find((key) => key.toLowerCase() === 'content-type')
        const contentType = contentTypeHeader && headers[contentTypeHeader]
        return contentTypes.some((ct) => contentType?.includes(ct))
    }

    if (!recordBody) return false
    if (_isBoolean(recordBody)) return true
    if (_isArray(recordBody)) return matchesContentType(recordBody)
    const recordBodyType = recordBody[type]
    if (_isBoolean(recordBodyType)) return recordBodyType
    return matchesContentType(recordBodyType)
}

async function getRequestPerformanceEntry(
    win: IWindow,
    initiatorType: string,
    url: string,
    after?: number,
    before?: number,
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
            (!after || entry.startTime >= after) &&
            (!before || entry.startTime <= before)
    )
    if (!performanceEntry) {
        await new Promise((resolve) => setTimeout(resolve, 50 * attempt))
        return getRequestPerformanceEntry(win, initiatorType, url, after, before, attempt + 1)
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
function _tryReadXHRBody(body: Document | XMLHttpRequestBodyInit | any | null | undefined): string | null {
    if (_isNullish(body)) {
        return null
    }

    if (_isString(body)) {
        return body
    }

    if (_isDocument(body)) {
        return body.textContent
    }

    if (_isFormData(body)) {
        return _formDataToQuery(body)
    }

    if (_isObject(body)) {
        try {
            return JSON.stringify(body)
        } catch (e) {
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
                let after: number | undefined
                let before: number | undefined

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
                    if (shouldRecordBody('request', options.recordBody, requestHeaders)) {
                        if (_isUndefined(body) || _isNull(body)) {
                            networkRequest.requestBody = null
                        } else {
                            networkRequest.requestBody = _tryReadXHRBody(body)
                        }
                    }
                    after = win.performance.now()
                    return originalSend(body)
                }

                xhr.addEventListener('readystatechange', () => {
                    if (xhr.readyState !== xhr.DONE) {
                        return
                    }
                    before = win.performance.now()
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
                    if (shouldRecordBody('response', options.recordBody, responseHeaders)) {
                        if (_isNullish(xhr.response)) {
                            networkRequest.responseBody = null
                        } else {
                            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                            networkRequest.responseBody = _tryReadXHRBody(xhr.response)
                        }
                    }
                    getRequestPerformanceEntry(win, 'xmlhttprequest', req.url, after, before)
                        .then((entry) => {
                            if (_isNull(entry)) {
                                return
                            }
                            const requests = prepareRequest(entry, req.method, xhr?.status, networkRequest)
                            cb({ requests })
                        })
                        .catch(() => {
                            //
                        })
                })
                originalOpen.call(xhr, method, url, async, username, password)
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
const exposesServerTiming = (event: PerformanceEntry): event is PerformanceResourceTiming =>
    event.entryType === 'navigation' || event.entryType === 'resource'

function prepareRequest(
    entry: PerformanceResourceTiming,
    method: string | undefined,
    status: number | undefined,
    networkRequest: Partial<CapturedNetworkRequest>,
    isInitial?: boolean
): CapturedNetworkRequest[] {
    // kudos to sentry javascript sdk for excellent background on why to use Date.now() here
    // https://github.com/getsentry/sentry-javascript/blob/e856e40b6e71a73252e788cd42b5260f81c9c88e/packages/utils/src/time.ts#L70
    // can't start observer if performance.now() is not available
    // eslint-disable-next-line compat/compat
    const timeOrigin = Math.floor(Date.now() - performance.now())
    // clickhouse can't ingest timestamps that are floats
    // (in this case representing fractions of a millisecond we don't care about anyway)
    const timestamp = Math.floor(timeOrigin + entry.startTime)

    const requests: CapturedNetworkRequest[] = [
        {
            ...entry.toJSON(),
            startTime: Math.round(entry.startTime),
            endTime: Math.round(entry.responseEnd),
            timeOrigin,
            timestamp,
            method: method,
            initiatorType: entry.initiatorType as InitiatorType,
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

function _checkForCannotReadResponseBody(r: Response): string | null {
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

    return null
}

function _tryReadBody(r: Request | Response): Promise<string> {
    // there are now already multiple places where we're using Promise...
    // eslint-disable-next-line compat/compat
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => resolve('[SessionReplay] Timeout while trying to read body'), 500)
        r.clone()
            .text()
            .then(
                (txt) => resolve(txt),
                (reason) => reject(reason)
            )
            .finally(() => clearTimeout(timeout))
    })
}

async function _tryReadResponseBody(r: Response): Promise<string> {
    const cannotReadBodyReason: string | null = _checkForCannotReadResponseBody(r)
    if (!_isNull(cannotReadBodyReason)) {
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
            let after: number | undefined
            let before: number | undefined
            try {
                const requestHeaders: Headers = {}
                req.headers.forEach((value, header) => {
                    requestHeaders[header] = value
                })
                if (recordRequestHeaders) {
                    networkRequest.requestHeaders = requestHeaders
                }
                if (shouldRecordBody('request', options.recordBody, requestHeaders)) {
                    networkRequest.requestBody = await _tryReadBody(req)
                }

                after = win.performance.now()
                res = await originalFetch(req)
                before = win.performance.now()

                const responseHeaders: Headers = {}
                res.headers.forEach((value, header) => {
                    responseHeaders[header] = value
                })
                if (recordResponseHeaders) {
                    networkRequest.responseHeaders = responseHeaders
                }
                if (shouldRecordBody('response', options.recordBody, responseHeaders)) {
                    networkRequest.responseBody = await _tryReadResponseBody(res)
                }

                return res
            } finally {
                getRequestPerformanceEntry(win, 'fetch', req.url, after, before)
                    .then((entry) => {
                        if (_isNull(entry)) {
                            return
                        }
                        const requests = prepareRequest(entry, req.method, res?.status, networkRequest)
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

    if (_isFunction(options.onNetworkCaptureReady)) {
        options.onNetworkCaptureReady()
    }

    return () => {
        performanceObserver()
        xhrObserver()
        fetchObserver()
    }
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

if (window) {
    ;(window as any).rrweb = { record: rrwebRecord, version: 'v2', rrwebVersion: version }
    ;(window as any).rrwebConsoleRecord = { getRecordConsolePlugin }
    ;(window as any).getRecordNetworkPlugin = getRecordNetworkPlugin
}

export default rrwebRecord
