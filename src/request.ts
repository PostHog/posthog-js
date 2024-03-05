import { _base64Encode, _each } from './utils'
import Config from './config'
import { Compression } from './types'
import { SUPPORTS_XHR, _formDataToQuery } from './utils/request-utils'

import { _isUndefined } from './utils/type-utils'
import { logger } from './utils/logger'
import { fetch, document, window } from './utils/globals'
import { gzipSync, strToU8 } from 'fflate'

export interface RequestResponse {
    statusCode: number
    text: string
    json?: any
}

export type RequestCallback = (response: RequestResponse) => void

export interface RequestOptions {
    url: string
    data?: Record<string, any>
    headers?: Record<string, any>
    transport?: 'XHR' | 'fetch' | 'sendBeacon'
    method?: 'POST' | 'GET'
    urlQueryArgs?: { compression: Compression }
    callback?: RequestCallback
    timeout?: number
    noRetries?: boolean
    compression?: Compression
}

// This is the entrypoint. It takes care of sanitizing the options and then calls the appropriate request method.
export const request = (_options: RequestOptions) => {
    // Clone the options so we don't modify the original object
    const options = { ..._options }
    options.timeout = options.timeout || 60000

    options.url = addParamsToURL(options.url, {
        // TODO: Move the ip to the right place
        // ip: parameterOptions['ip'] ? 1 : 0,
        _: new Date().getTime().toString(),
        ver: Config.LIB_VERSION,
        compression: options.compression,
    })

    if (options.transport === 'sendBeacon' && window?.navigator?.sendBeacon) {
        return sendBeacon(options)
    }

    // NOTE: Until we are confident with it, we only use fetch if explicitly told so
    // At some point we will make it the default over xhr
    if (options.transport === 'fetch' && fetch) {
        return _fetch(options)
    }

    if (SUPPORTS_XHR || !document) {
        return xhr(options)
    }

    // Final fallback if everything else fails...
    scriptRequest(options)
}

export const addParamsToURL = (url: string, params: Record<string, any> | undefined): string => {
    const args = params || {}

    const halves = url.split('?')
    if (halves.length > 1) {
        const params = halves[1].split('&')
        for (const p of params) {
            const key = p.split('=')[0]
            if (!_isUndefined(args[key])) {
                delete args[key]
            }
        }
    }

    const argSeparator = url.indexOf('?') > -1 ? '&' : '?'
    return url + argSeparator + _formDataToQuery(args)
}

const encodeToDataString = (data: string | Record<string, any>): string => {
    return 'data=' + encodeURIComponent(typeof data === 'string' ? data : JSON.stringify(data))
}

const encodePostData = ({ data, compression, transport, method }: RequestOptions): string | BlobPart | null => {
    if (!data) {
        return null
    }

    // :TRICKY: This returns an UInt8Array. We don't encode this to a string - returning a blob will do this for us.
    if (compression === Compression.GZipJS) {
        const gzipData = gzipSync(strToU8(JSON.stringify(data)), { mtime: 0 })
        return new Blob([gzipData], { type: 'text/plain' })
    }

    if (compression === Compression.Base64) {
        const b64data = _base64Encode(JSON.stringify(data))
        return encodeToDataString(b64data)
    }

    if (transport === 'sendBeacon') {
        const body = encodeToDataString(data)
        return new Blob([body], { type: 'application/x-www-form-urlencoded' })
    }

    if (method !== 'POST') {
        return null
    }

    return encodeToDataString(data)
}

const xhr = (options: RequestOptions) => {
    // if (_isNumber(retriesPerformedSoFar) && retriesPerformedSoFar > 0) {
    //     url = addParamsToURL(url, { retry_count: retriesPerformedSoFar }, {})
    // }

    const req = new XMLHttpRequest()
    req.open(options.method || 'GET', options.url, true)
    const body = encodePostData(options)

    _each(options.headers, function (headerValue, headerName) {
        req.setRequestHeader(headerName, headerValue)
    })

    if (options.method === 'POST' && typeof body === 'string') {
        req.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded')
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
            // onResponse?.(minimalResponseSummary)
            if (req.status === 200) {
                try {
                    response.json = JSON.parse(req.responseText)
                } catch (e) {
                    logger.error(e)
                    return
                }
            }

            options.callback?.(response)

            // if (_isFunction(onError)) {
            //     onError(minimalResponseSummary)
            // }

            // // don't retry errors between 400 and 500 inclusive
            // if (retryQueue && (req.status < 400 || req.status > 500)) {
            //     retryQueue.enqueue({
            //         url,
            //         data,
            //         options,
            //         headers,
            //         retriesPerformedSoFar: (retriesPerformedSoFar || 0) + 1,
            //         callback,
            //     })
            // }
        }
    }
    req.send(body)
}

const _fetch = (options: RequestOptions) => {
    if (!fetch) {
        // NOTE: This is just for type checking
        return
    }

    const body = encodePostData(options)

    // eslint-disable-next-line compat/compat
    const headers = new Headers()
    _each(headers, function (headerValue, headerName) {
        headers.append(headerName, headerValue)
    })

    if (options.method === 'POST' && typeof body === 'string') {
        headers.append('Content-Type', 'application/x-www-form-urlencoded')
    }

    const url = options.url

    fetch(url, {
        method: options?.method || 'GET',
        headers,
        keepalive: options.method === 'POST',
        body,
    })
        .then((response) => {
            // Report to the callback handlers
            return response.text().then((responseText) => {
                const res: RequestResponse = {
                    statusCode: response.status,
                    text: responseText,
                }
                // options.onResponse?.({
                //     statusCode,
                //     responseText,
                // })

                if (response.status === 200) {
                    try {
                        res.json = JSON.parse(responseText)
                    } catch (e) {
                        logger.error(e)
                    }
                }

                options.callback?.(res)

                // if (_isFunction(options.onError)) {
                //     params.onError({
                //         statusCode,
                //         responseText,
                //     })
                // }

                // don't retry errors between 400 and 500 inclusive
                // if (params.retryQueue && (statusCode < 400 || statusCode > 500)) {
                //     params.retryQueue.enqueue({
                //         ...params,
                //         headers,
                //         retriesPerformedSoFar: (params.retriesPerformedSoFar || 0) + 1,
                //     })
                // }
            })
        })
        .catch((error) => {
            logger.error(error)
            options.callback?.({ statusCode: 0, text: error })
        })

    return
}

const sendBeacon = (options: RequestOptions) => {
    // beacon documentation https://w3c.github.io/beacon/
    // beacons format the message and use the type property
    try {
        // eslint-disable-next-line compat/compat
        window?.navigator?.sendBeacon(options.url, encodePostData(options))
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
