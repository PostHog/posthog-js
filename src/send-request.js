import { _, console } from './utils'

export const encodePostData = (data, options) => {
    if (options.blob) {
        return new Blob([data.buffer], { type: 'text/plain' })
    } else if (options.sendBeacon) {
        const body = encodePostData(data, { method: 'POST' })
        return new Blob([body], { type: 'application/x-www-form-urlencoded' })
    } else if (options.method !== 'POST') {
        return null
    } else if (options.plainText) {
        return data
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

export const xhr = (url, data, options, captureMetrics, callback) => {
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

            const data = captureMetrics.finishRequest(requestId)

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

                captureMetrics.markRequestFailed({
                    ...data,
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
