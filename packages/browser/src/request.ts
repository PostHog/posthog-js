import { each, find } from './utils'
import Config from './config'
import { Compression, RequestWithOptions, RequestResponse } from './types'
import { formDataToQuery } from './utils/request-utils'

import { logger } from './utils/logger'
import { AbortController, fetch, navigator, XMLHttpRequest } from './utils/globals'
import { gzipSync, strToU8 } from 'fflate'

import { _base64Encode } from './utils/encode-utils'

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
type EncodedBody = {
    contentType: string
    body: string | BlobPart
    estimatedSize: number
}

export const extendURLParams = (url: string, params: Record<string, any>): string => {
    const [baseUrl, search] = url.split('?')
    const newParams = { ...params }

    search?.split('&').forEach((pair) => {
        const [key] = pair.split('=')
        delete newParams[key]
    })

    let newSearch = formDataToQuery(newParams)
    newSearch = newSearch ? (search ? search + '&' : '') + newSearch : search

    return `${baseUrl}?${newSearch}`
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

const encodePostData = ({ data, compression }: RequestWithOptions): EncodedBody | undefined => {
    if (!data) {
        return
    }

    if (compression === Compression.GZipJS) {
        const gzipData = gzipSync(strToU8(jsonStringify(data)), { mtime: 0 })
        const blob = new Blob([gzipData], { type: CONTENT_TYPE_PLAIN })
        return {
            contentType: CONTENT_TYPE_PLAIN,
            body: blob,
            estimatedSize: blob.size,
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
            options.callback?.({ statusCode: 0, text: error })
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
        // sendBeacon requires a blob so we convert it
        const sendBeaconBody = typeof body === 'string' ? new Blob([body], { type: contentType }) : body
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
    const options = { ..._options }
    options.timeout = options.timeout || 60000

    options.url = extendURLParams(options.url, {
        _: new Date().getTime().toString(),
        ver: Config.LIB_VERSION,
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

    transportMethod(options)
}
