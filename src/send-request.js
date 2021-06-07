import { _, console } from './utils'

export const encodePostData = (data, options) => {
    if (options.blob) {
        return new Blob([data.buffer], { type: 'text/plain' })
    } else if (options.sendBeacon) {
        const body = encodePostData(data, { method: 'POST' })
        return new Blob([body], { type: 'application/x-www-form-urlencoded' })
    } else if (options.method !== 'POST') {
        return null
    }

    let body_data
    if (Array.isArray(data)) {
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
    headers = {},
    options,
    captureMetrics,
    callback,
    retriesPerformedSoFar,
    retryQueue,
}) => {
    const req = new XMLHttpRequest()
    req.open(options.method, url, true)

    const body = encodePostData(data, options)

    captureMetrics.incr('_send_request')
    captureMetrics.incr('_send_request_inflight')

    const requestId = captureMetrics.startRequest({
        data_size: _.isString(data) ? data.length : body.length,
        endpoint: url.slice(url.length - 2),
        ...options._metrics,
    })
    
    if (options.method === 'POST' && !options.blob) {
        headers = { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }
    }

    _.each(headers, function (headerValue, headerName) {
        req.setRequestHeader(headerName, headerValue)
    })

    // send the ph_optout cookie
    // withCredentials cannot be modified until after calling .open on Android and Mobile Safari
    req.withCredentials = true
    req.onreadystatechange = () => {
        if (req.readyState === 4) {
            captureMetrics.incr(`xhr-response`)
            captureMetrics.incr(`xhr-response-${req.status}`)
            captureMetrics.decr('_send_request_inflight')

            const metricsData = captureMetrics.finishRequest(requestId)

            // XMLHttpRequest.DONE == 4, except in safari 4
            if (req.status === 200) {
                if (callback) {
                    let response
                    try {
                        response = JSON.parse(req.responseText)
                    } catch (e) {
                        console.error(e)
                        return
                    }
                    callback(response)
                }
            } else {
                const error = 'Bad HTTP status: ' + req.status + ' ' + req.statusText
                console.error(error)

                // don't retry certain errors
                if ([401, 403, 404].indexOf(req.status) < 0) {
                    retryQueue.enqueue({
                        url,
                        data,
                        options,
                        headers,
                        retriesPerformedSoFar: (retriesPerformedSoFar || 0) + 1,
                        callback,
                    })
                }

                captureMetrics.markRequestFailed({
                    ...metricsData,
                    type: 'non_200',
                    status: req.status,
                    statusText: req.statusText,
                })

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
