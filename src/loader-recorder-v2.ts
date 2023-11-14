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
import { InitiatorType, NetworkRecordOptions, NetworkRequest, Headers } from './types'
import { _isBoolean, _isFunction, _isArray, _isUndefined, _isNull } from './utils/type-utils'
import { logger } from './utils/logger'
import { defaultNetworkOptions } from './extensions/replay/config'

export type NetworkData = {
    requests: NetworkRequest[]
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
    if (options.recordInitialRequests) {
        const initialPerformanceEntries = win.performance
            .getEntries()
            .filter(
                (entry): entry is ObservedPerformanceEntry =>
                    isNavigationTiming(entry) ||
                    (isResourceTiming(entry) && options.initiatorTypes.includes(entry.initiatorType as InitiatorType))
            )
        cb({
            requests: initialPerformanceEntries.map((entry) => ({
                url: entry.name,
                initiatorType: entry.initiatorType as InitiatorType,
                status: 'responseStatus' in entry ? entry.responseStatus : undefined,
                startTime: Math.round(entry.startTime),
                endTime: Math.round(entry.responseEnd),
            })),
            isInitial: true,
        })
    }
    const observer = new win.PerformanceObserver((entries) => {
        const performanceEntries = entries
            .getEntries()
            .filter(
                (entry): entry is ObservedPerformanceEntry =>
                    isNavigationTiming(entry) ||
                    (isResourceTiming(entry) &&
                        options.initiatorTypes.includes(entry.initiatorType as InitiatorType) &&
                        entry.initiatorType !== 'xmlhttprequest' &&
                        entry.initiatorType !== 'fetch')
            )
        cb({
            requests: performanceEntries.map((entry) => ({
                url: entry.name,
                initiatorType: entry.initiatorType as InitiatorType,
                status: 'responseStatus' in entry ? entry.responseStatus : undefined,
                startTime: Math.round(entry.startTime),
                endTime: Math.round(entry.responseEnd),
            })),
        })
    })
    observer.observe({ entryTypes: ['navigation', 'resource'] })
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
        // TODO how should this be typed?
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
                const networkRequest: Partial<NetworkRequest> = {}
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
                            networkRequest.requestBody = body
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
                        if (_isUndefined(xhr.response) || _isNull(xhr.response)) {
                            networkRequest.responseBody = null
                        } else {
                            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                            networkRequest.responseBody = xhr.response
                        }
                    }
                    getRequestPerformanceEntry(win, 'xmlhttprequest', req.url, after, before)
                        .then((entry) => {
                            if (_isNull(entry)) {
                                return
                            }
                            const request: NetworkRequest = {
                                url: entry.name,
                                method: req.method,
                                initiatorType: entry.initiatorType as InitiatorType,
                                status: xhr.status,
                                startTime: Math.round(entry.startTime),
                                endTime: Math.round(entry.responseEnd),
                                requestHeaders: networkRequest.requestHeaders,
                                requestBody: networkRequest.requestBody,
                                responseHeaders: networkRequest.responseHeaders,
                                responseBody: networkRequest.responseBody,
                            }
                            cb({ requests: [request] })
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
    // TODO how should this be typed?
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const restorePatch = patch(win, 'fetch', (originalFetch: typeof fetch) => {
        return async function (url: URL | RequestInfo, init?: RequestInit | undefined) {
            // check IE earlier than this, we only initialize if Request is present
            // eslint-disable-next-line compat/compat
            const req = new Request(url, init)
            let res: Response | undefined
            const networkRequest: Partial<NetworkRequest> = {}
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
                    if (_isUndefined(req.body) || _isNull(req.body)) {
                        networkRequest.requestBody = null
                    } else {
                        networkRequest.requestBody = req.body
                    }
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
                    let body: string | undefined
                    try {
                        body = await res.clone().text()
                    } catch {
                        //
                    }
                    if (_isUndefined(res.body) || _isNull(res.body)) {
                        networkRequest.responseBody = null
                    } else {
                        networkRequest.responseBody = body
                    }
                }
                return res
            } finally {
                getRequestPerformanceEntry(win, 'fetch', req.url, after, before)
                    .then((entry) => {
                        if (_isNull(entry)) {
                            return
                        }
                        const request: NetworkRequest = {
                            url: entry.name,
                            method: req.method,
                            initiatorType: entry.initiatorType as InitiatorType,
                            status: res?.status,
                            startTime: Math.round(entry.startTime),
                            endTime: Math.round(entry.responseEnd),
                            requestHeaders: networkRequest.requestHeaders,
                            requestBody: networkRequest.requestBody,
                            responseHeaders: networkRequest.responseHeaders,
                            responseBody: networkRequest.responseBody,
                        }
                        cb({ requests: [request] })
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
        const requests: NetworkRequest[] = []
        data.requests.forEach((request) => {
            const maskedRequest = networkOptions.maskRequestFn(request)
            if (maskedRequest) {
                requests.push(maskedRequest)
            }
        })

        if (requests.length > 0 || data.isInitial) {
            callback({ ...data, requests })
        }
    }
    const performanceObserver = initPerformanceObserver(cb, win, networkOptions)
    const xhrObserver = initXhrObserver(cb, win, networkOptions)
    const fetchObserver = initFetchObserver(cb, win, networkOptions)
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

const win: Window & typeof globalThis = _isUndefined(window) ? ({} as typeof window) : window

;(win as any).rrweb = { record: rrwebRecord, version: 'v2', rrwebVersion: version }
;(win as any).rrwebConsoleRecord = { getRecordConsolePlugin }
;(win as any).getRecordNetworkPlugin = getRecordNetworkPlugin

export default rrwebRecord
