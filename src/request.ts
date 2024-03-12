import { _base64Encode, _each } from './utils'
import Config from './config'
import { Compression, RequestOptions, RequestResponse } from './types'
import { _formDataToQuery } from './utils/request-utils'

import { logger } from './utils/logger'
import { fetch, document, XMLHttpRequest, AbortController, navigator } from './utils/globals'
import { gzipSync, strToU8 } from 'fflate'

// eslint-disable-next-line compat/compat
export const SUPPORTS_REQUEST = !!XMLHttpRequest || !!fetch

const CT_PLAIN = 'text/plain'
const CT_JSON = 'application/json'
const CT_FORM = 'application/x-www-form-urlencoded'

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

    if (options.transport === 'sendBeacon' && navigator?.sendBeacon) {
        return _sendBeacon(options)
    }

    // NOTE: Until we are confident with it, we only use fetch if explicitly told so
    // At some point we will make it the default over xhr
    if (options.transport === 'fetch' && fetch) {
        return _fetch(options)
    }

    if (XMLHttpRequest || !document) {
        return xhr(options)
    }

    // Final fallback if everything else fails...
    scriptRequest(options)
}

export const extendURLParams = (url: string, params: Record<string, any>): string => {
    const [baseUrl, search] = url.split('?')
    const newParams = { ...params }

    search?.split('&').forEach((pair) => {
        const [key] = pair.split('=')
        delete newParams[key]
    })

    let newSearch = _formDataToQuery(newParams)
    newSearch = newSearch ? (search ? search + '&' : '') + newSearch : search

    return `${baseUrl}?${newSearch}`
}

const encodeToDataString = (data: string | Record<string, any>): string => {
    return 'data=' + encodeURIComponent(typeof data === 'string' ? data : JSON.stringify(data))
}

const encodePostData = ({
    data,
    compression,
    transport,
}: RequestOptions): {
    contentType?: string
    body: string | BlobPart | null
} | null => {
    if (!data) {
        return null
    }

    // Gzip is always a blob
    if (compression === Compression.GZipJS) {
        const gzipData = gzipSync(strToU8(JSON.stringify(data)), { mtime: 0 })
        return {
            contentType: CT_PLAIN,
            body: new Blob([gzipData], { type: CT_PLAIN }),
        }
    }

    // sendBeacon is always a blob but can be base64 encoded internally
    if (transport === 'sendBeacon') {
        const body = compression === Compression.Base64 ? _base64Encode(JSON.stringify(data)) : data
        return {
            contentType: CT_FORM,
            body: new Blob([encodeToDataString(body)], { type: CT_FORM }),
        }
    }

    if (compression === Compression.Base64) {
        const b64data = _base64Encode(JSON.stringify(data))

        return {
            contentType: CT_FORM,
            body: encodeToDataString(b64data),
        }
    }

    return {
        contentType: CT_JSON,
        body: JSON.stringify(data),
    }
}

const xhr = (options: RequestOptions) => {
    const req = new XMLHttpRequest!()
    req.open(options.method || 'GET', options.url, true)
    const { contentType, body } = encodePostData(options) ?? {}

    _each(options.headers, function (headerValue, headerName) {
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
    _each(headers, function (headerValue, headerName) {
        headers.append(headerName, headerValue)
    })

    if (contentType) {
        headers.append('Content-Type', contentType)
    }

    const url = options.url
    let aborter: { signal: any; timeout: number } | null = null

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
        // eslint-disable-next-line compat/compat
        const { body } = encodePostData(options) ?? {}
        navigator!.sendBeacon!(url, body)
    } catch (e) {
        // send beacon is a best-effort, fire-and-forget mechanism on page unload,
        // we don't want to throw errors here
    }
}

const scriptRequest = (options: RequestOptions) => {
    if (!document) {
        return
    }
    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.async = true
    script.defer = true
    script.src = options.url
    const s = document.getElementsByTagName('script')[0]
    s.parentNode?.insertBefore(script, s)
}
