import { each, find } from './utils'
import Config from './config'
import { Compression, RequestWithOptions, RequestResponse } from './types'
import { formDataToQuery } from './utils/request-utils'

import { logger } from './utils/logger'
import { AbortController, CompressionStream, fetch, navigator, XMLHttpRequest } from './utils/globals'
import { gzipSync, strToU8 } from 'fflate'

import { _base64Encode } from './utils/encode-utils'
import { gzipCompress, isNativeAsyncGzipReadError } from '@posthog/core'

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

export const __resetNativeAsyncGzipDisabledForTests = (): void => {
    nativeAsyncGzipDisabled = false
}

type EncodedBody = {
    contentType: string
    body: string | BlobPart | ArrayBuffer
    estimatedSize: number
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
    const compressedBlob = await gzipCompress(jsonData, Config.DEBUG, { rethrow: true })
    if (!compressedBlob) {
        return options
    }
    const body = await compressedBlob.arrayBuffer()

    return {
        ...options,
        _encodedBody: {
            contentType: CONTENT_TYPE_PLAIN,
            body,
            estimatedSize: body.byteLength,
        },
    }
}

const xhr = (options: RequestWithOptions) => {
    const req = new XMLHttpRequest!()
    req.open(options.method || 'GET', options.url, true)
    const { contentType, body } = encodePostData(options) ?? {}

    each(options.headers, function (headerValue, headerName) {
        req.setRequestHeader(headerName, headerValue)
    })

    if (contentType) {
        req.setRequestHeader('Content-Type', contentType)
    }

    if (options.timeout) {
        req.timeout = options.timeout
    }
    if (!options.disableXHRCredentials) {
        // send the ph_optout cookie
        // withCredentials cannot be modified until after calling .open on Android and Mobile Safari
        req.withCredentials = true
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
    const { contentType, body, estimatedSize } = encodePostData(options) ?? {}

    // eslint-disable-next-line compat/compat
    const headers = new Headers()
    each(options.headers, function (headerValue, headerName) {
        headers.append(headerName, headerValue)
    })

    if (contentType) {
        headers.append('Content-Type', contentType)
    }

    const url = options.url
    let aborter: { signal: any; timeout: ReturnType<typeof setTimeout> } | null = null

    if (AbortController) {
        const controller = new AbortController()
        aborter = {
            signal: controller.signal,
            timeout: setTimeout(() => controller.abort(), options.timeout),
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
            logger.error(error)
            options.callback?.({ statusCode: 0, error })
        })
        .finally(() => (aborter ? clearTimeout(aborter.timeout) : null))

    return
}

const _sendBeacon = (options: RequestWithOptions) => {
    // beacon documentation https://w3c.github.io/beacon/
    // beacons format the message and use the type property

    const url = extendURLParams(options.url, {
        beacon: '1',
    })

    try {
        const { contentType, body } = encodePostData(options) ?? {}
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

    options.url = extendURLParams(options.url, {
        _: new Date().getTime().toString(),
        ver: Config.JS_SDK_VERSION,
        compression: options.compression,
    })

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
                    })
                    return
                }

                // If async compression fails for another reason, fall back to the synchronous fflate path
                transportMethod(options)
            })
    } else {
        transportMethod(options)
    }
}
