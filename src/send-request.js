import { _, console } from './utils'

export const encodePostDataBody = (data) => {
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

export const xhr = (url, method, data, headers, verbose, captureMetrics, callback) => {
    const body = method === 'POST' ? encodePostDataBody(data) : null

    this._captureMetrics.incr('_send_request')
    this._captureMetrics.incr('_send_request_inflight')

    const requestId = this._captureMetrics.startRequest({
        data_size: body && body.length,
        endpoint: url.slice(url.length - 2),
        ...options._metrics,
    })

    const req = new XMLHttpRequest()
    req.open(method, url, true)
    if (method === 'POST') {
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
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
                    if (verbose) {
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
