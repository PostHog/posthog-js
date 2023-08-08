import { _each, _HTTPBuildQuery, logger } from './utils'
import Config from './config'
import { PostData, XHROptions, XHRParams } from './types'

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
            if (args[key]) {
                delete args[key]
            }
        }
    }

    const argSeparator = url.indexOf('?') > -1 ? '&' : '?'
    return url + argSeparator + _HTTPBuildQuery(args)
}

export const encodePostData = (data: PostData | Uint8Array, options: Partial<XHROptions>): string | BlobPart | null => {
    if (options.blob && data.buffer) {
        return new Blob([data.buffer], { type: 'text/plain' })
    }

    if (options.sendBeacon || options.blob) {
        const body = encodePostData(data, { method: 'POST' }) as BlobPart
        return new Blob([body], { type: 'application/x-www-form-urlencoded' })
    }

    if (options.method !== 'POST') {
        return null
    }

    let body_data
    const isUint8Array = (d: unknown): d is Uint8Array => Object.prototype.toString.call(d) === '[object Uint8Array]'
    if (Array.isArray(data) || isUint8Array(data)) {
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

export const xhr = ({
    url,
    data,
    headers,
    options,
    callback,
    retriesPerformedSoFar,
    retryQueue,
    onXHRError,
    timeout = 10000,
    onResponse,
}: XHRParams) => {
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
            onResponse?.(req)
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
                if (typeof onXHRError === 'function') {
                    onXHRError(req)
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
