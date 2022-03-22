import { _, logger } from './utils'

export const encodePostData = (data, options) => {
    if (options.blob && data.buffer) {
        return new Blob([data.buffer], { type: 'text/plain' })
    }

    if (options.sendBeacon || options.blob) {
        const body = encodePostData(data, { method: 'POST' })
        return new Blob([body], { type: 'application/x-www-form-urlencoded' })
    }

    if (options.method !== 'POST') {
        return null
    }

    let body_data
    const isUint8Array = (d) => Object.prototype.toString.call(d) === '[object Uint8Array]'
    if (Array.isArray(data) || isUint8Array(data)) {
        body_data = 'data=' + encodeURIComponent(data)
    } else {
        body_data = 'data=' + encodeURIComponent(data['data'])
    }

    if (data['compression']) {
        body_data += '&compression=' + data['compression']
    }

    return body_data
}

export const xhr = ({
    url,
    data,
    headers,
    options,
    captureMetrics,
    callback,
    retriesPerformedSoFar,
    retryQueue,
    onXHRError,
}) => {
    const req = new XMLHttpRequest()
    req.open(options.method, url, true)

    const body = encodePostData(data, options)

    captureMetrics.incr('_send_request')
    captureMetrics.incr('_send_request_inflight')

    _.each(headers, function (headerValue, headerName) {
        req.setRequestHeader(headerName, headerValue)
    })
    if (options.method === 'POST' && !options.blob) {
        req.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded')
    }

    // send the ph_optout cookie
    // withCredentials cannot be modified until after calling .open on Android and Mobile Safari
    req.withCredentials = true
    req.onreadystatechange = () => {
        if (req.readyState === 4) {
            captureMetrics.incr(`xhr-response`)
            captureMetrics.incr(`xhr-response-${req.status}`)
            captureMetrics.decr('_send_request_inflight')

            // XMLHttpRequest.DONE == 4, except in safari 4
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

                // don't retry certain errors
                if ([401, 403, 404, 500].indexOf(req.status) < 0) {
                    retryQueue.enqueue({
                        url,
                        data,
                        options,
                        headers,
                        retriesPerformedSoFar: (retriesPerformedSoFar || 0) + 1,
                        callback,
                    })
                }

                if (callback) {
                    if (options.verbose) {
                        callback({ status: 0, error: error })
                    } else {
                        callback(0)
                    }
                }
            }
        }
    }
    req.send(body)
}
