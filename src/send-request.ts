import { _each } from './utils'
import Config from './config'
import { PostData, XHROptions, RequestData, MinimalHTTPResponse } from './types'
import { _HTTPBuildQuery } from './utils/request-utils'

import { _isArray, _isFunction, _isNumber, _isUint8Array, _isUndefined } from './utils/type-utils'
import { logger } from './utils/logger'
import { fetch } from './utils/globals'

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
    return url + argSeparator + _HTTPBuildQuery(args)
}

export const encodePostData = (data: PostData | Uint8Array, options: Partial<XHROptions>): string | BlobPart | null => {
    if (options.blob && data.buffer) {
        return new Blob([_isUint8Array(data) ? data : data.buffer], { type: 'text/plain' })
    }

    if (options.sendBeacon || options.blob) {
        const body = encodePostData(data, { method: 'POST' }) as BlobPart
        return new Blob([body], { type: 'application/x-www-form-urlencoded' })
    }

    if (options.method !== 'POST') {
        return null
    }

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

export const request = (params: RequestData) => {
    // NOTE: Until we are confident with it, we only use fetch if explicitly told so
    if (fetch && params.options.transport === 'fetch') {
        const body = encodePostData(params.data, params.options)

        const headers = new Headers()
        _each(headers, function (headerValue, headerName) {
            headers.append(headerName, headerValue)
        })

        if (params.options.method === 'POST' && !params.options.blob) {
            headers.append('Content-Type', 'application/x-www-form-urlencoded')
        }

        let url = params.url

        if (_isNumber(params.retriesPerformedSoFar) && params.retriesPerformedSoFar > 0) {
            url = addParamsToURL(url, { retry_count: params.retriesPerformedSoFar }, {})
        }

        fetch(url, {
            method: params.options?.method || 'GET',
            headers,
            keepalive: params.options.method === 'POST',
            body,
        })
            .then((response) => {
                const statusCode = response.status
                // Report to the callback handlers
                return response.text().then((responseText) => {
                    params.onResponse?.({
                        statusCode,
                        responseText,
                    })

                    if (statusCode === 200) {
                        try {
                            params.callback?.(JSON.parse(responseText))
                        } catch (e) {
                            logger.error(e)
                        }
                        return
                    }

                    if (_isFunction(params.onError)) {
                        params.onError({
                            statusCode,
                            responseText,
                        })
                    }

                    // don't retry errors between 400 and 500 inclusive
                    if (statusCode < 400 || statusCode > 500) {
                        params.retryQueue.enqueue({
                            ...params,
                            headers,
                            retriesPerformedSoFar: (params.retriesPerformedSoFar || 0) + 1,
                        })
                    }
                    params.callback?.({ status: 0 })
                })
            })
            .catch((error) => {
                logger.error(error)
                params.callback?.({ status: 0 })
            })

        return
    }

    return xhr(params)
}

const xhr = ({
    url,
    data,
    headers,
    options,
    callback,
    retriesPerformedSoFar,
    retryQueue,
    onError,
    timeout = 60000,
    onResponse,
}: RequestData) => {
    if (_isNumber(retriesPerformedSoFar) && retriesPerformedSoFar > 0) {
        url = addParamsToURL(url, { retry_count: retriesPerformedSoFar }, {})
    }

    const req = new XMLHttpRequest()
    req.open(options.method || 'GET', url, true)

    const body = encodePostData(data, options)

    _each(headers, function (headerValue, headerName) {
        req.setRequestHeader(headerName, headerValue)
    })

    if (options.method === 'POST' && !options.blob) {
        req.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded')
    }

    req.timeout = timeout
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
            onResponse?.(minimalResponseSummary)
            if (req.status === 200) {
                if (callback) {
                    let response
                    try {
                        response = JSON.parse(req.responseText)
                    } catch (e) {
                        logger.error(e)
                        return
                    }
                    callback(response)
                }
            } else {
                if (_isFunction(onError)) {
                    onError(minimalResponseSummary)
                }

                // don't retry errors between 400 and 500 inclusive
                if (req.status < 400 || req.status > 500) {
                    retryQueue.enqueue({
                        url,
                        data,
                        options,
                        headers,
                        retriesPerformedSoFar: (retriesPerformedSoFar || 0) + 1,
                        callback,
                    })
                }

                callback?.({ status: 0 })
            }
        }
    }
    req.send(body)
}
