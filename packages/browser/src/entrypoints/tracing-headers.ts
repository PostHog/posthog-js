import { SessionIdManager } from '../sessionid'
import { patch } from '../extensions/replay/rrweb-plugins/patch'
import { assignableWindow, window } from '../utils/globals'
import { COOKIELESS_SENTINEL_VALUE } from '../constants'
import { isArray, isFunction, isNull, isUndefined } from '@posthog/core'
import type { TracingHeadersDistinctId, TracingHeadersHostnames } from '../extensions/tracing-headers-types'

const SESSION_ID_HEADER = 'X-POSTHOG-SESSION-ID'
const WINDOW_ID_HEADER = 'X-POSTHOG-WINDOW-ID'
const DISTINCT_ID_HEADER = 'X-POSTHOG-DISTINCT-ID'
const TRACING_HEADERS = [SESSION_ID_HEADER, WINDOW_ID_HEADER, DISTINCT_ID_HEADER]
const REQUEST_INIT_KEYS = [
    'attributionReporting',
    'body',
    'browsingTopics',
    'cache',
    'credentials',
    'dispatcher',
    'duplex',
    'integrity',
    'keepalive',
    'method',
    'mode',
    'priority',
    'redirect',
    'referrer',
    'referrerPolicy',
    'signal',
    'window',
]

const hasOwnProperty = (value: object, property: PropertyKey): boolean =>
    Object.prototype.hasOwnProperty.call(value, property)

const isObjectLike = (value: unknown): value is object =>
    (typeof value === 'object' && !isNull(value)) || isFunction(value)

const isRequest = (value: unknown): value is Request =>
    typeof Request !== 'undefined' &&
    (value instanceof Request || Object.prototype.toString.call(value) === '[object Request]')

const getRequestUrl = (url: URL | RequestInfo): string | undefined => {
    try {
        if (isRequest(url)) {
            return url.url
        }

        // eslint-disable-next-line compat/compat
        return new URL(url instanceof URL ? url.toString() : String(url), window?.location?.href).toString()
    } catch {
        return undefined
    }
}

// RequestInit is a WebIDL dictionary: native fetch reads known keys via property access, including inherited
// and non-enumerable properties. Avoid `{ ...init, headers }`, which can drop body/signal/duplex/etc. Instead,
// overlay only `headers` while forwarding every other lookup to the caller's original init object.
const createFetchInitWithHeaders = (init: RequestInit | undefined, headers: Headers): RequestInit | undefined => {
    if (isUndefined(init) || isNull(init)) {
        return { headers }
    }
    if (!isObjectLike(init)) {
        return undefined
    }

    const originalInit = init as RequestInit & Record<PropertyKey, unknown>

    if (typeof Proxy === 'undefined' || typeof Reflect === 'undefined') {
        // Older browsers without Proxy still get an inherited overlay, which preserves native fetch property lookup.
        const initWithHeaders = Object.create(originalInit) as RequestInit
        Object.defineProperty(initWithHeaders, 'headers', {
            configurable: true,
            enumerable: true,
            value: headers,
            writable: true,
        })
        return initWithHeaders
    }

    const target = { headers } as RequestInit & Record<PropertyKey, unknown>

    return new Proxy(target, {
        get(target, property) {
            if (hasOwnProperty(target, property)) {
                return Reflect.get(target, property)
            }
            return Reflect.get(originalInit, property, originalInit)
        },
        has(target, property) {
            return hasOwnProperty(target, property) || property in originalInit
        },
        ownKeys(target) {
            const keys = new Set<string | symbol>(Reflect.ownKeys(target))
            Reflect.ownKeys(originalInit).forEach((key) => keys.add(key))
            REQUEST_INIT_KEYS.forEach((key) => {
                if (key in originalInit) {
                    keys.add(key)
                }
            })
            return Array.from(keys)
        },
        getOwnPropertyDescriptor(target, property) {
            const targetDescriptor = Reflect.getOwnPropertyDescriptor(target, property)
            if (targetDescriptor) {
                return targetDescriptor
            }
            if (typeof property === 'string' && REQUEST_INIT_KEYS.includes(property) && property in originalInit) {
                return {
                    configurable: true,
                    enumerable: true,
                    get: () => Reflect.get(originalInit, property, originalInit),
                }
            }

            const descriptor = Reflect.getOwnPropertyDescriptor(originalInit, property)
            return descriptor ? { ...descriptor, configurable: true } : undefined
        },
        getPrototypeOf() {
            return Object.getPrototypeOf(originalInit)
        },
    }) as RequestInit
}

const getDistinctId = (distinctId: TracingHeadersDistinctId): string | undefined =>
    isFunction(distinctId) ? distinctId() : distinctId

const appendTracingHeaders = (
    hostnames: TracingHeadersHostnames,
    distinctId: TracingHeadersDistinctId,
    sessionManager: SessionIdManager | undefined,
    url: string,
    headers: Headers
): boolean => {
    let reqHostname: string
    try {
        // we don't need to support IE11 here
        // eslint-disable-next-line compat/compat
        reqHostname = new URL(url).hostname
    } catch {
        // If the URL is invalid, we skip adding tracing headers
        return false
    }
    if (!hostnames) {
        return false
    }
    if (isArray(hostnames) && !hostnames.includes(reqHostname)) {
        // Skip if the hostname is not in the list (also skip if hostnames is not an array,
        // because in the earliest version of the legacy __add_tracing_headers option it was a bool)
        return false
    }

    let hasAddedHeaders = false
    if (sessionManager) {
        const { sessionId, windowId } = sessionManager.checkAndGetSessionAndWindowId(true)
        headers.set(SESSION_ID_HEADER, sessionId)
        headers.set(WINDOW_ID_HEADER, windowId)
        hasAddedHeaders = true
    }
    const currentDistinctId = getDistinctId(distinctId)
    if (currentDistinctId && currentDistinctId !== COOKIELESS_SENTINEL_VALUE) {
        headers.set(DISTINCT_ID_HEADER, currentDistinctId)
        hasAddedHeaders = true
    }
    return hasAddedHeaders
}

type FetchArgs = [URL | RequestInfo] | [URL | RequestInfo, RequestInit | undefined]

const patchFetch = (
    hostnames: TracingHeadersHostnames,
    distinctId: TracingHeadersDistinctId,
    sessionManager?: SessionIdManager
): (() => void) => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return patch(window, 'fetch', (originalFetch: typeof fetch) => {
        return function (this: unknown, url: URL | RequestInfo, init?: RequestInit | undefined) {
            const originalArgs = (arguments.length > 1 ? [url, init] : [url]) as FetchArgs
            let fetchArgs = originalArgs

            try {
                const requestUrl = getRequestUrl(url)
                if (requestUrl) {
                    if (isRequest(url)) {
                        // For fetch(Request, init), construct a new Request so init overrides are applied and the
                        // caller's Request is not mutated. For fetch(url, init), avoid this because it exposes string
                        // bodies as ReadableStreams to downstream wrappers in Safari.
                        // eslint-disable-next-line compat/compat
                        const req = new Request(url, init)
                        appendTracingHeaders(hostnames, distinctId, sessionManager, req.url, req.headers)
                        fetchArgs = [req]
                    } else {
                        const headers = new Headers(isObjectLike(init) ? init.headers : undefined)
                        if (appendTracingHeaders(hostnames, distinctId, sessionManager, requestUrl, headers)) {
                            const initWithHeaders = createFetchInitWithHeaders(init, headers)
                            if (initWithHeaders) {
                                fetchArgs = [url, initWithHeaders]
                            }
                        }
                    }
                }
            } catch {
                fetchArgs = originalArgs
            }

            return originalFetch.apply(this, fetchArgs)
        }
    })
}

const patchXHR = (
    hostnames: TracingHeadersHostnames,
    distinctId: TracingHeadersDistinctId,
    sessionManager?: SessionIdManager
): (() => void) => {
    return patch(
        // we can assert this is present because we've checked previously
        window!.XMLHttpRequest.prototype,
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

                const headers = new Headers()
                const requestUrl = getRequestUrl(url)
                if (requestUrl) {
                    appendTracingHeaders(hostnames, distinctId, sessionManager, requestUrl, headers)
                }

                const result = originalOpen.call(xhr, method, url, async, username, password)

                TRACING_HEADERS.forEach((header) => {
                    const value = headers.get(header)
                    if (value) {
                        try {
                            xhr.setRequestHeader(header, value)
                        } catch {
                            // Do not let tracing header injection break the host app's XHR.
                        }
                    }
                })

                return result
            }
        }
    )
}

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
const patchFns = {
    _patchFetch: patchFetch,
    _patchXHR: patchXHR,
}
assignableWindow.__PosthogExtensions__.tracingHeadersPatchFns = patchFns

// we used to put tracingHeadersPatchFns on window, and now we put it on __PosthogExtensions__
// but that means that old clients which lazily load this extension are looking in the wrong place
// yuck,
// so we also put it directly on the window
// when 1.161.1 is the oldest version seen in production we can remove this
assignableWindow.postHogTracingHeadersPatchFns = patchFns

export default patchFns
