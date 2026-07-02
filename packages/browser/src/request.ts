import { each, find } from './utils'
import Config from './config'
import { Compression, RequestWithOptions, RequestResponse } from './types'
import { formDataToQuery, getQueryParam } from './utils/request-utils'

import { logger } from './utils/logger'
import { AbortController, CompressionStream, fetch, navigator, XMLHttpRequest } from './utils/globals'
import { gzipSync, strToU8 } from 'fflate'

import { _base64Encode } from './utils/encode-utils'
import {
    gzipCompress,
    isGzipData,
    isGzipRequest,
    isNativeAsyncGzipError,
    isNativeAsyncGzipReadError,
} from '@posthog/core'

interface RequestWithEncodedBody extends RequestWithOptions {
    _encodedBody?: EncodedBody
}

// eslint-disable-next-line compat/compat
export const SUPPORTS_REQUEST = !!XMLHttpRequest || !!fetch

const CONTENT_TYPE_PLAIN = 'text/plain'
const CONTENT_TYPE_JSON = 'application/json'
const CONTENT_TYPE_FORM = 'application/x-www-form-urlencoded'
const SIXTY_FOUR_KILOBYTES = 64 * 1024
/*
 fetch will fail if we request keepalive with a body greater than 64kb
 sets the threshold lower than that so that
 any overhead doesn't push over the threshold after checking here
*/
const KEEP_ALIVE_THRESHOLD = SIXTY_FOUR_KILOBYTES * 0.8
let nativeAsyncGzipDisabled = false

const removeURLParam = (url: string, param: string): string => {
    const [urlWithoutHash, hash] = url.split('#')
    const [baseUrl, search] = urlWithoutHash.split('?')

    if (!search) {
        return url
    }

    const updatedSearch = search
        .split('&')
        .filter((pair) => pair.split('=')[0] !== param)
        .join('&')

    return `${baseUrl}${updatedSearch ? `?${updatedSearch}` : ''}${hash ? `#${hash}` : ''}`
}

type EncodedBody = {
    contentType: string
    body: string | BlobPart | ArrayBuffer
    estimatedSize: number
}

type EncodedRequest = {
    url: string
    encodedBody?: EncodedBody
}

/**
 * Extends a URL with additional query parameters
 * @param url - The URL to extend
 * @param params - The parameters to add
 * @param replace - When true (default), new params overwrite existing ones with same key. When false, existing params are preserved.
 * @returns The URL with extended parameters
 */
export const extendURLParams = (url: string, params: Record<string, any>, replace: boolean = true): string => {
    const [baseUrl, search] = url.split('?')
    const newParams = { ...params }

    const updatedSearch =
        search?.split('&').map((pair) => {
            const [key, origValue] = pair.split('=')
            const value = replace ? (newParams[key] ?? origValue) : origValue
            delete newParams[key]
            return `${key}=${value}`
        }) ?? []

    const remaining = formDataToQuery(newParams)
    if (remaining) {
        updatedSearch.push(remaining)
    }

    return `${baseUrl}?${updatedSearch.join('&')}`
}

export const jsonStringify = (data: any, space?: string | number): string => {
    // With plain JSON.stringify, we get an exception when a property is a BigInt. This has caused problems for some users,
    // see https://github.com/PostHog/posthog-js/issues/1440
    // To work around this, we convert BigInts to strings before stringifying the data. This is not ideal, as we lose
    // information that this was originally a number, but given ClickHouse doesn't support BigInts, the customer
    // would not be able to operate on these numerically anyway.
    return JSON.stringify(data, (_, value) => (typeof value === 'bigint' ? value.toString() : value), space)
}

const encodeToDataString = (data: string | Record<string, any>): string => {
    return 'data=' + encodeURIComponent(typeof data === 'string' ? data : jsonStringify(data))
}

const encodePostData = (options: RequestWithEncodedBody): EncodedBody | undefined => {
    // Use pre-encoded body if available (set by async compression in the request entrypoint)
    if (options._encodedBody) {
        return options._encodedBody
    }

    const { data, compression } = options
    if (!data) {
        return
    }

    if (compression === Compression.GZipJS) {
        const gzipData = gzipSync(strToU8(jsonStringify(data)), { mtime: 0 })
        return {
            contentType: CONTENT_TYPE_PLAIN,
            body: gzipData.buffer.slice(gzipData.byteOffset, gzipData.byteOffset + gzipData.byteLength) as ArrayBuffer,
            estimatedSize: gzipData.byteLength,
        }
    }

    if (compression === Compression.Base64) {
        const b64data = _base64Encode(jsonStringify(data))
        const encodedBody = encodeToDataString(b64data)

        return {
            contentType: CONTENT_TYPE_FORM,
            body: encodedBody,
            estimatedSize: new Blob([encodedBody]).size,
        }
    }

    const jsonBody = jsonStringify(data)
    return {
        contentType: CONTENT_TYPE_JSON,
        body: jsonBody,
        estimatedSize: new Blob([jsonBody]).size,
    }
}

const encodePostDataSafely = (options: RequestWithEncodedBody): EncodedRequest => {
    const fallbackToUncompressed = (): EncodedRequest => {
        return {
            url: removeURLParam(options.url, 'compression'),
            encodedBody: encodePostData({
                ...options,
                compression: undefined,
                _encodedBody: undefined,
            }),
        }
    }

    let encodedBody: EncodedBody | undefined
    try {
        encodedBody = encodePostData(options)
    } catch (error) {
        if (isGzipRequest(options.compression, getQueryParam(options.url, 'compression'))) {
            logger.error('Failed to gzip request body, sending uncompressed payload', error)
            return fallbackToUncompressed()
        }

        throw error
    }

    if (
        !encodedBody ||
        !isGzipRequest(options.compression, getQueryParam(options.url, 'compression')) ||
        isGzipData(encodedBody.body)
    ) {
        return { url: options.url, encodedBody }
    }

    nativeAsyncGzipDisabled = true
    return fallbackToUncompressed()
}

const encodeRequest = (options: RequestWithEncodedBody): EncodedRequest | undefined => {
    try {
        return encodePostDataSafely(options)
    } catch (error) {
        logger.error(error)
        options.callback?.({ statusCode: 0, error })
        return undefined
    }
}

/**
 * Pre-encode the request body using async native CompressionStream.
 * This avoids blocking the main thread with fflate's synchronous gzip,
 * which can take 300ms+ on constrained devices.
 *
 * Callers must check preconditions (data exists, gzip compression, CompressionStream available)
 * before calling this function.
 */
const preEncodeAsync = async (options: RequestWithEncodedBody): Promise<RequestWithEncodedBody> => {
    const jsonData = jsonStringify(options.data)
    const compressed = await gzipCompress(jsonData, Config.DEBUG, { rethrow: true })
    if (!compressed) {
        return options
    }
    const body = await compressed.arrayBuffer()

    return {
        ...options,
        _encodedBody: {
            contentType: CONTENT_TYPE_PLAIN,
            body,
            estimatedSize: body.byteLength,
        },
    }
}

/**
 * Builds the reason used when aborting a fetch because our own request timeout elapsed.
 * It keeps `name === 'AbortError'` (so callers that detect timeouts by error name keep working)
 * but carries a descriptive message, so it is never a reason-less
 * `signal is aborted without reason` exception.
 */
const timeoutAbortReason = (timeout?: number): Error => {
    const reason = new Error(`PostHog request timed out${timeout ? ` after ${timeout}ms` : ''}`)
    reason.name = 'AbortError'
    return reason
}

const xhr = (options: RequestWithOptions) => {
    const encodedRequest = encodeRequest(options)
    if (!encodedRequest) {
        return
    }

    const req = new XMLHttpRequest!()
    const { url, encodedBody } = encodedRequest
    req.open(options.method || 'GET', url, true)
    const { contentType, body } = encodedBody ?? {}

    each(options.headers, function (headerValue, headerName) {
        req.setRequestHeader(headerName, headerValue)
    })

    if (contentType) {
        req.setRequestHeader('Content-Type', contentType)
    }

    if (options.timeout) {
        req.timeout = options.timeout
    }
    req.onreadystatechange = () => {
        // XMLHttpRequest.DONE == 4, except in safari 4
        if (req.readyState === 4) {
            const response: RequestResponse = {
                statusCode: req.status,
                text: req.responseText,
            }
            if (req.status === 200) {
                try {
                    response.json = JSON.parse(req.responseText)
                } catch {
                    // logger.error(e)
                }
            }

            options.callback?.(response)
        }
    }
    req.send(body)
}

const _fetch = (options: RequestWithOptions) => {
    const encodedRequest = encodeRequest(options)
    if (!encodedRequest) {
        return
    }

    const { url, encodedBody } = encodedRequest
    const { contentType, body, estimatedSize } = encodedBody ?? {}

    // eslint-disable-next-line compat/compat
    const headers = new Headers()
    each(options.headers, function (headerValue, headerName) {
        headers.append(headerName, headerValue)
    })

    if (contentType) {
        headers.append('Content-Type', contentType)
    }

    let aborter: { signal: any; timeout: ReturnType<typeof setTimeout> } | null = null
    // Set the instant our own timeout fires, before the abort propagates. This is the source of
    // truth for "we timed out ourselves" - see the `.catch` below for why we can't rely on the
    // abort reason.
    let timedOut = false

    if (AbortController) {
        const controller = new AbortController()
        aborter = {
            signal: controller.signal,
            timeout: setTimeout(() => {
                timedOut = true
                // Abort with an explicit reason. Without one, the browser rejects the fetch with a
                // reason-less `DOMException: AbortError: signal is aborted without reason`, which is
                // indistinguishable from a host app's own aborted fetches wherever it surfaces (the
                // `{ statusCode: 0, error }` callback, logs, stack traces). An explicit reason makes
                // our own request timeouts identifiable. We keep `name === 'AbortError'` so existing
                // timeout handling (e.g. feature flag timeout detection) keeps working.
                controller.abort(timeoutAbortReason(options.timeout))
            }, options.timeout),
        }
    }

    fetch!(url, {
        method: options?.method || 'GET',
        headers,
        // if body is greater than 64kb, then fetch with keepalive will error
        // see 8:10:5 at https://fetch.spec.whatwg.org/#http-network-or-cache-fetch,
        // but we do want to set keepalive sometimes as it can  help with success
        // when e.g. a page is being closed
        // so let's get the best of both worlds and only set keepalive for POST requests
        // where the body is less than 64kb
        // NB this is fetch keepalive and not http keepalive
        keepalive: options.method === 'POST' && (estimatedSize || 0) < KEEP_ALIVE_THRESHOLD,
        body,
        signal: aborter?.signal,
        ...options.fetchOptions,
    })
        .then((response) => {
            return response.text().then((responseText) => {
                const res: RequestResponse = {
                    statusCode: response.status,
                    text: responseText,
                }

                if (response.status === 200) {
                    try {
                        res.json = JSON.parse(responseText)
                    } catch (e) {
                        logger.error(e)
                    }
                }

                options.callback?.(res)
            })
        })
        .catch((error) => {
            // Detect our own timeout via the `timedOut` flag rather than by comparing `error`
            // against the reason we passed to `controller.abort(...)`. Not every browser propagates
            // the abort reason to the fetch rejection - some reject with a generic native
            // `DOMException: AbortError: The operation was aborted.` instead - so a reference (or
            // message) comparison misses those and misclassifies our own timeout as a real error.
            // The flag is set synchronously the instant our timeout fires, and we additionally
            // require `name === 'AbortError'` so a genuine network error that happens to settle
            // just after the timeout is never mislabelled.
            if (timedOut && (error as Error)?.name === 'AbortError') {
                // Our own request timeout is an expected, intentional abort (the request queue
                // retries), not a genuine failure - so log it at `warn` rather than `error`. This
                // also keeps it out of error tracking's console-error capture as an exception.
                logger.warn(error)
            } else {
                logger.error(error)
            }
            options.callback?.({ statusCode: 0, error })
        })
        .finally(() => (aborter ? clearTimeout(aborter.timeout) : null))

    return
}

const _sendBeacon = (options: RequestWithOptions) => {
    // beacon documentation https://w3c.github.io/beacon/
    // beacons format the message and use the type property

    try {
        const { url, encodedBody } = encodePostDataSafely(options)
        const { contentType, body } = encodedBody ?? {}
        if (!body) {
            return
        }
        // sendBeacon requires a Blob to set the Content-Type header correctly.
        // Without wrapping, ArrayBuffer bodies are sent with no Content-Type,
        // which can cause issues with proxies/WAFs that require it.
        const sendBeaconBody = body instanceof Blob ? body : new Blob([body], { type: contentType })
        navigator!.sendBeacon!(url, sendBeaconBody)
    } catch {
        // send beacon is a best-effort, fire-and-forget mechanism on page unload,
        // we don't want to throw errors here
    }
}

const buildRequestURL = (url: string, compression?: RequestWithOptions['compression']): string => {
    return extendURLParams(url, {
        _: new Date().getTime().toString(),
        ver: Config.JS_SDK_VERSION,
        compression,
    })
}

const AVAILABLE_TRANSPORTS: {
    transport: RequestWithOptions['transport']
    method: (options: RequestWithOptions) => void
}[] = []

// We add the transports in order of preference
if (fetch) {
    AVAILABLE_TRANSPORTS.push({
        transport: 'fetch',
        method: _fetch,
    })
}

if (XMLHttpRequest) {
    AVAILABLE_TRANSPORTS.push({
        transport: 'XHR',
        method: xhr,
    })
}

if (navigator?.sendBeacon) {
    AVAILABLE_TRANSPORTS.push({
        transport: 'sendBeacon',
        method: _sendBeacon,
    })
}

// This is the entrypoint. It takes care of sanitizing the options and then calls the appropriate request method.
export const request = (_options: RequestWithOptions) => {
    // Clone the options so we don't modify the original object
    const options: RequestWithEncodedBody = { ..._options }
    options.timeout = options.timeout || 60000

    options.url = buildRequestURL(options.url, options.compression)

    const transport = options.transport ?? 'fetch'

    const availableTransports = AVAILABLE_TRANSPORTS.filter(
        (t) => !options.disableTransport || !t.transport || !options.disableTransport.includes(t.transport)
    )

    const transportMethod =
        find(availableTransports, (t) => t.transport === transport)?.method ?? availableTransports[0].method

    if (!transportMethod) {
        throw new Error('No available transport method')
    }

    // For non-sendBeacon transports, use async native CompressionStream when available
    // to avoid blocking the main thread with fflate's synchronous gzip (which can take 300ms+).
    // sendBeacon must remain synchronous as it's used during page unload.
    if (
        transport !== 'sendBeacon' &&
        options.data &&
        options.compression === Compression.GZipJS &&
        !!CompressionStream &&
        typeof Promise !== 'undefined' &&
        !nativeAsyncGzipDisabled
    ) {
        preEncodeAsync(options)
            .then((encodedOptions) => {
                transportMethod(encodedOptions)
            })
            .catch((error) => {
                if (isNativeAsyncGzipReadError(error)) {
                    nativeAsyncGzipDisabled = true
                    transportMethod({
                        ...options,
                        compression: undefined,
                        url: buildRequestURL(_options.url, undefined),
                    })
                    return
                }

                if (isNativeAsyncGzipError(error)) {
                    nativeAsyncGzipDisabled = true
                }

                // If async compression fails for another reason, fall back to the synchronous fflate path
                transportMethod(options)
            })
    } else {
        transportMethod(options)
    }
}
