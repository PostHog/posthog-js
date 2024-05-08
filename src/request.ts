import { _base64Encode, each, find } from './utils'
import Config from './config'
import { Compression, RequestOptions, RequestResponse } from './types'
import { formDataToQuery } from './utils/request-utils'

import { logger } from './utils/logger'
import { fetch, XMLHttpRequest, AbortController, navigator } from './utils/globals'
import { gzipSync, strToU8 } from 'fflate'

// eslint-disable-next-line compat/compat
export const SUPPORTS_REQUEST = !!XMLHttpRequest || !!fetch

const CONTENT_TYPE_PLAIN = 'text/plain'
const CONTENT_TYPE_JSON = 'application/json'
const CONTENT_TYPE_FORM = 'application/x-www-form-urlencoded'

type EncodedBody = {
    contentType: string
    body: string | BlobPart
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

const encodeToDataString = (data: string | Record<string, any>): string => {
    return 'data=' + encodeURIComponent(typeof data === 'string' ? data : JSON.stringify(data))
}

const encodePostData = ({ data, compression }: RequestOptions): EncodedBody | undefined => {
    if (!data) {
        return
    }

    if (compression === Compression.GZipJS) {
        const gzipData = gzipSync(strToU8(JSON.stringify(data)), { mtime: 0 })
        return {
            contentType: CONTENT_TYPE_PLAIN,
            body: new Blob([gzipData], { type: CONTENT_TYPE_PLAIN }),
        }
    }

    if (compression === Compression.Base64) {
        const b64data = _base64Encode(JSON.stringify(data))

        return {
            contentType: CONTENT_TYPE_FORM,
            body: encodeToDataString(b64data),
        }
    }

    return {
        contentType: CONTENT_TYPE_JSON,
        body: JSON.stringify(data),
    }
}

const xhr = (options: RequestOptions) => {
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
    // send the ph_optout cookie
    // withCredentials cannot be modified until after calling .open on Android and Mobile Safari
    req.withCredentials = true
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
                } catch (e) {
                    // logger.error(e)
                }
            }

            options.callback?.(response)
        }
    }
    req.send(body)
}

const _fetch = (options: RequestOptions) => {
    const { contentType, body } = encodePostData(options) ?? {}

    // eslint-disable-next-line compat/compat
    const headers = new Headers()
    each(headers, function (headerValue, headerName) {
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
        keepalive: options.method === 'POST',
        body,
        signal: aborter?.signal,
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

const _sendBeacon = (options: RequestOptions) => {
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
    } catch (e) {
        // send beacon is a best-effort, fire-and-forget mechanism on page unload,
        // we don't want to throw errors here
    }
}

const AVAILABLE_TRANSPORTS: { transport: RequestOptions['transport']; method: (options: RequestOptions) => void }[] = []

// We add the transports in order of preference

if (XMLHttpRequest) {
    AVAILABLE_TRANSPORTS.push({
        transport: 'XHR',
        method: xhr,
    })
}

if (fetch) {
    AVAILABLE_TRANSPORTS.push({
        transport: 'fetch',
        method: _fetch,
    })
}

if (navigator?.sendBeacon) {
    AVAILABLE_TRANSPORTS.push({
        transport: 'sendBeacon',
        method: _sendBeacon,
    })
}

// This is the entrypoint. It takes care of sanitizing the options and then calls the appropriate request method.
export const request = (_options: RequestOptions) => {
    // Clone the options so we don't modify the original object
    const options = { ..._options }
    options.timeout = options.timeout || 60000

    options.url = extendURLParams(options.url, {
        _: new Date().getTime().toString(),
        ver: Config.LIB_VERSION,
        compression: options.compression,
    })

    const transport = options.transport ?? 'XHR'

    const transportMethod =
        find(AVAILABLE_TRANSPORTS, (t) => t.transport === transport)?.method ?? AVAILABLE_TRANSPORTS[0].method

    if (!transportMethod) {
        throw new Error('No available transport method')
    }

    transportMethod(options)
}

const AVAILABLE_TRANSPORTS: { transport: RequestOptions['transport']; method: (options: RequestOptions) => void }[] = []

// We add the transports in order of preference

if (XMLHttpRequest) {
    AVAILABLE_TRANSPORTS.push({
        transport: 'XHR',
        method: xhr,
    })
}

if (fetch) {
    AVAILABLE_TRANSPORTS.push({
        transport: 'fetch',
        method: _fetch,
    })
}

if (navigator?.sendBeacon) {
    AVAILABLE_TRANSPORTS.push({
        transport: 'sendBeacon',
        method: _sendBeacon,
    })
}

AVAILABLE_TRANSPORTS.push({
    transport: undefined,
    method: scriptRequest,
})

// This is the entrypoint. It takes care of sanitizing the options and then calls the appropriate request method.
export const request = (_options: RequestOptions) => {
    // Clone the options so we don't modify the original object
    const options = { ..._options }
    options.timeout = options.timeout || 60000

    options.url = extendURLParams(options.url, {
        _: new Date().getTime().toString(),
        ver: Config.LIB_VERSION,
        compression: options.compression,
    })

    const transport = options.transport ?? 'XHR'

    const transportMethod =
        find(AVAILABLE_TRANSPORTS, (t) => t.transport === transport)?.method ?? AVAILABLE_TRANSPORTS[0].method

    if (!transportMethod) {
        throw new Error('No available transport method')
    }

    transportMethod(options)
}
