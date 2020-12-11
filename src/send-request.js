import { _, logIfDebug } from './utils'

export const encodePostData = (data, options) => {
    if (options.blob) {
        return new Blob([data.buffer], { type: 'text/plain' })
    } else if (options.sendBeacon) {
        const body = encodePostData(data, {})
        return new Blob([body], { type: 'text/plain' })
    }

    return data
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
                        callback(response)
                    } catch (e) {
                        logIfDebug(e)
                    }
                }
            } else {
                logIfDebug('Bad HTTP status: ' + req.status + ' ' + req.statusText, req)

                captureMetrics.markRequestFailed({
                    ...data,
                    type: 'non_200',
                    status: req.status,
                    statusText: req.statusText,
                })

                if (callback) {
                    callback(0)
                }
            }
        }
    }
    req.send(body)
}
