import { SessionIdManager } from '../sessionid'
import { patch } from '../extensions/replay/rrweb-plugins/patch'
import { window } from '@posthog/browser-common/utils/globals'
import { assignableWindow } from '../utils/globals'
import { COOKIELESS_SENTINEL_VALUE } from '../constants'
import { isArray, isFunction, isNull, isString, isUndefined } from '@posthog/core'
import type {
    TraceparentTargets,
    TracingHeadersDistinctId,
    TracingHeadersHostnames,
} from '../extensions/tracing-headers-types'

const SESSION_ID_HEADER = 'X-POSTHOG-SESSION-ID'
const WINDOW_ID_HEADER = 'X-POSTHOG-WINDOW-ID'
const DISTINCT_ID_HEADER = 'X-POSTHOG-DISTINCT-ID'
const TRACING_HEADERS = [SESSION_ID_HEADER, WINDOW_ID_HEADER, DISTINCT_ID_HEADER]
// W3C Trace Context, https://www.w3.org/TR/trace-context/#traceparent-header
const TRACEPARENT_HEADER = 'traceparent'
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

        // oxlint-disable-next-line compat/compat
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

    const target: RequestInit & Record<PropertyKey, unknown> = { headers }

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

const addTracingHeaders = (
    hostnames: TracingHeadersHostnames,
    distinctId: TracingHeadersDistinctId,
    sessionManager: SessionIdManager | undefined,
    url: string,
    headers: Headers
): boolean => {
    let reqHostname: string
    try {
        // we don't need to support IE11 here
        // oxlint-disable-next-line compat/compat
        reqHostname = new URL(url).hostname
    } catch {
        // If the URL is invalid, we skip adding tracing headers
        return false
    }
    if (!hostnames) {
        return false
    }
    if (isArray(hostnames) && !hostnames.includes(reqHostname)) {
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

const randomHex = (byteLength: number): string => {
    const bytes = new Uint8Array(byteLength)
    const crypto = window?.crypto
    if (crypto && isFunction(crypto.getRandomValues)) {
        crypto.getRandomValues(bytes)
    } else {
        for (let i = 0; i < byteLength; i++) {
            bytes[i] = Math.floor(Math.random() * 256)
        }
    }
    let hex = ''
    for (let i = 0; i < byteLength; i++) {
        hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16)
    }
    return hex
}

// All-zero trace and span ids are invalid, so regenerate in the (astronomically unlikely) all-zero case.
const randomNonZeroHex = (byteLength: number): string => {
    let hex = randomHex(byteLength)
    while (/^0+$/.test(hex)) {
        hex = randomHex(byteLength)
    }
    return hex
}

// OpenTelemetry's XHR instrumentation wraps send() with shimmer (which marks the wrapper `__wrapped`) and injects
// traceparent from inside it through the global propagator. If it wrapped send() before we did, it runs after our
// injection, and XHR appends rather than replaces, so the header would end up with two comma-joined values.
// Leave those requests to it. (If it wraps send() after us, it sets the header first and setRequestHeader sees it.)
type PatchedFunction = {
    __wrapped?: unknown
    __posthog_layer__?: { next?: unknown }
    __rrweb_layer__?: { next?: unknown }
}

const otelWrapsSendBelow = (next: unknown): boolean => {
    try {
        let current: unknown = next
        // Other posthog/rrweb patch layers (e.g. session replay network capture) can sit between us and it.
        for (let depth = 0; isFunction(current) && depth < 20; depth++) {
            const fn = current as PatchedFunction
            if (fn.__wrapped) {
                const otel = (window as unknown as Record<symbol, { propagation?: unknown } | undefined> | undefined)?.[
                    Symbol.for('opentelemetry.js.api.1')
                ]
                return !!otel?.propagation
            }
            current = (fn.__posthog_layer__ ?? fn.__rrweb_layer__)?.next
        }
        return false
    } catch {
        return false
    }
}

const isTraceparentHeaderName = (name: unknown): boolean => {
    try {
        // Native XHR converts the name with String(), so `new String('traceparent')` is the same header.
        return String(name).toLowerCase() === TRACEPARENT_HEADER
    } catch {
        return false
    }
}

// A fresh trace per request, version 00, sampled flag 01. No client span is recorded, so the parent id
// is a span id that only exists in this header; the server span becomes the root of the stored trace.
const createTraceparent = (): string => `00-${randomNonZeroHex(16)}-${randomNonZeroHex(8)}-01`

const targetOrigin = (target: string): string | undefined => {
    try {
        // oxlint-disable-next-line compat/compat
        return new URL(target).origin
    } catch {
        return undefined
    }
}

/**
 * Targets are matched exactly: entries containing `://` are compared to the request origin
 * (e.g. `https://api.example.com:8443`), anything else to the request hostname (e.g. `api.example.com`).
 */
const isTraceparentTarget = (targets: TraceparentTargets, url: string): boolean => {
    if (!isArray(targets) || targets.length === 0) {
        return false
    }
    let parsed: URL
    try {
        // oxlint-disable-next-line compat/compat
        parsed = new URL(url)
    } catch {
        return false
    }
    for (let i = 0; i < targets.length; i++) {
        const target = targets[i]
        if (!isString(target)) {
            continue
        }
        if (target.indexOf('://') > -1) {
            // Parse the target too, so default ports (`https://api.example.com:443`) and case match URL.origin.
            if (targetOrigin(target) === parsed.origin) {
                return true
            }
        } else if (target.toLowerCase() === parsed.hostname) {
            return true
        }
    }
    return false
}

const addTraceparentHeader = (targets: TraceparentTargets, url: string, headers: Headers): boolean => {
    // Never overwrite a traceparent the app (or another instrumentation) already set.
    if (headers.has(TRACEPARENT_HEADER) || !isTraceparentTarget(targets, url)) {
        return false
    }
    headers.set(TRACEPARENT_HEADER, createTraceparent())
    return true
}

type FetchArgs = [URL | RequestInfo] | [URL | RequestInfo, RequestInit | undefined]

const patchFetch = (
    hostnames: TracingHeadersHostnames,
    distinctId: TracingHeadersDistinctId,
    sessionManager?: SessionIdManager,
    traceparentTargets?: TraceparentTargets
): (() => void) => {
    // oxlint-disable-next-line typescript/ban-ts-comment
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
                        const req = new Request(url, init)
                        addTracingHeaders(hostnames, distinctId, sessionManager, req.url, req.headers)
                        addTraceparentHeader(traceparentTargets, req.url, req.headers)
                        fetchArgs = [req]
                    } else {
                        const headers = new Headers(isObjectLike(init) ? init.headers : undefined)
                        const addedTracingHeaders = addTracingHeaders(
                            hostnames,
                            distinctId,
                            sessionManager,
                            requestUrl,
                            headers
                        )
                        const addedTraceparent = addTraceparentHeader(traceparentTargets, requestUrl, headers)
                        if (addedTracingHeaders || addedTraceparent) {
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
    sessionManager?: SessionIdManager,
    traceparentTargets?: TraceparentTargets
): (() => void) => {
    // The app sets its own XHR headers after open(), and setRequestHeader appends rather than replaces,
    // so the request url is remembered in open() and traceparent is only decided and set in send(), against
    // the live target list, unless the app set one in between.
    const pendingTraceparents =
        isArray(traceparentTargets) && typeof WeakMap !== 'undefined'
            ? new WeakMap<XMLHttpRequest, string>()
            : undefined

    const restoreOpen = patch(
        // we can assert this is present because we've checked previously
        window!.XMLHttpRequest.prototype,
        'open',
        // oxlint-disable-next-line typescript/ban-ts-comment
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
                // oxlint-disable-next-line typescript/ban-ts-comment
                // @ts-ignore
                const xhr = this as XMLHttpRequest

                const headers = new Headers()
                const requestUrl = getRequestUrl(url)
                if (requestUrl) {
                    addTracingHeaders(hostnames, distinctId, sessionManager, requestUrl, headers)
                }
                if (pendingTraceparents) {
                    pendingTraceparents.delete(xhr)
                    if (requestUrl) {
                        pendingTraceparents.set(xhr, requestUrl)
                    }
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

    if (!pendingTraceparents) {
        return restoreOpen
    }

    const xhrPrototype = window!.XMLHttpRequest.prototype
    const restoreSetRequestHeader = patch(
        xhrPrototype,
        'setRequestHeader',
        // oxlint-disable-next-line typescript/ban-ts-comment
        // @ts-ignore
        (originalSetRequestHeader: typeof XMLHttpRequest.prototype.setRequestHeader) => {
            return function (this: XMLHttpRequest, name: string, value: string) {
                if (isTraceparentHeaderName(name)) {
                    pendingTraceparents.delete(this)
                }
                return originalSetRequestHeader.call(this, name, value)
            }
        }
    )
    const restoreSend = patch(
        xhrPrototype,
        'send',
        // oxlint-disable-next-line typescript/ban-ts-comment
        // @ts-ignore
        (originalSend: typeof XMLHttpRequest.prototype.send) => {
            return function (this: XMLHttpRequest) {
                const requestUrl = pendingTraceparents.get(this)
                if (requestUrl) {
                    pendingTraceparents.delete(this)
                    try {
                        if (
                            isTraceparentTarget(traceparentTargets, requestUrl) &&
                            !otelWrapsSendBelow(sendLayer?.next)
                        ) {
                            this.setRequestHeader(TRACEPARENT_HEADER, createTraceparent())
                        }
                    } catch {
                        // Do not let traceparent injection break the host app's XHR.
                    }
                }
                // oxlint-disable-next-line prefer-rest-params
                return originalSend.apply(this, arguments as unknown as Parameters<XMLHttpRequest['send']>)
            }
        }
    )

    // patch() hands the wrapper a delegate, so read what sits beneath it from the installed layer.
    const sendLayer = (xhrPrototype.send as unknown as PatchedFunction).__posthog_layer__

    return () => {
        restoreSend()
        restoreSetRequestHeader()
        restoreOpen()
    }
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
