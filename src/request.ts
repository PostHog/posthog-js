import { _each } from './utils'
import Config from './config'
import { PostData, Compression } from './types'
import { SUPPORTS_XHR, _formDataToQuery } from './utils/request-utils'

import { _isArray, _isUint8Array, _isUndefined } from './utils/type-utils'
import { logger } from './utils/logger'
import { fetch, document, window } from './utils/globals'

export interface MinimalHTTPResponse {
    statusCode: number
    responseText: string
}

export type RequestCallback = (response: Record<string, any>, data?: Record<string, any>) => void

export interface RequestOptions {
    url: string
    data?: Record<string, any>
    headers?: Record<string, any>
    transport?: 'XHR' | 'fetch' | 'sendBeacon'
    method?: 'POST' | 'GET'
    urlQueryArgs?: { compression: Compression }
    blob?: boolean
    callback?: RequestCallback
    timeout?: number
    noRetries?: boolean
}

export const addParamsToURL = (
    url: string,
    urlQueryArgs: Record<string, any> | undefined,
    parameterOptions: { ip?: boolean }
): string => {
    const args = urlQueryArgs || {}
    args['ip'] = parameterOptions['ip'] ? 1 : 0
    args['_'] = new Date().getTime().toString()
    args['ver'] = Config.LIB_VERSION

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

const encodeDataToString = (data: PostData | Uint8Array): string => {
    let body_data

    if (_isArray(data) || _isUint8Array(data)) {
        // TODO: eh? passing an Array here?
        body_data = 'data=' + encodeURIComponent(data as any)
    } else {
        body_data = 'data=' + encodeURIComponent(data.data as string)
    }

    if ('compression' in data && data.compression) {
        body_data += '&compression=' + data.compression
    }

    return body_data
}

const encodePostData = ({ data, blob, transport, method }: RequestOptions): string | BlobPart | null => {
    if (!data) {
        return null
    }

    if (blob && data?.buffer) {
        return new Blob([_isUint8Array(data) ? data : data.buffer], { type: 'text/plain' })
    }

    if (transport === 'sendBeacon' || blob) {
        const body = encodeDataToString(data)
        return new Blob([body], { type: 'application/x-www-form-urlencoded' })
    }

    if (method !== 'POST') {
        return null
    }

    return encodeDataToString(data)
}

export const request = (options: RequestOptions) => {
    options.timeout = options.timeout || 60000
    // NOTE: Until we are confident with it, we only use fetch if explicitly told so
    if (options.transport === 'fetch' && fetch) {
        return _fetch(options)
    }

    if (options.transport === 'sendBeacon' && window?.navigator?.sendBeacon) {
        return sendBeacon(options)
    }

    if (SUPPORTS_XHR || !document) {
        return xhr(options)
    }

    // Final fallback if everything else fails...
    scriptRequest(options)
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

    if (options.method === 'POST' && !options.blob) {
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
            const minimalResponseSummary: MinimalHTTPResponse = {
                statusCode: req.status,
                responseText: req.responseText,
            }
            // onResponse?.(minimalResponseSummary)
            if (req.status === 200) {
                if (options.callback) {
                    let response
                    try {
                        response = JSON.parse(req.responseText)
                    } catch (e) {
                        logger.error(e)
                        return
                    }
                    options.callback(response)
                }
            } else {
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

                options.callback?.({ status: 0 })
            }
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

    if (options.method === 'POST' && !options.blob) {
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
            const statusCode = response.status
            // Report to the callback handlers
            return response.text().then((responseText) => {
                // options.onResponse?.({
                //     statusCode,
                //     responseText,
                // })

                if (statusCode === 200) {
                    try {
                        options.callback?.(JSON.parse(responseText))
                    } catch (e) {
                        logger.error(e)
                    }
                    return
                }

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
                options.callback?.({ status: 0 })
            })
        })
        .catch((error) => {
            logger.error(error)
            options.callback?.({ status: 0 })
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
