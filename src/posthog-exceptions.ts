import { EXCEPTION_CAPTURE_ENDPOINT } from './constants'
import { PostHog } from './posthog-core'
import { DecideResponse } from './types'
import { isObject } from './utils/type-utils'

// TODO: move this to /x/ as default
export const BASE_ERROR_ENDPOINT = '/e/'

export class PostHogExceptions {
    private _endpoint: string

    constructor(private readonly instance: PostHog) {
        // TODO: once BASE_ERROR_ENDPOINT is no longer /e/ this can be removed
        this._endpoint = this.instance.persistence?.props[EXCEPTION_CAPTURE_ENDPOINT] || BASE_ERROR_ENDPOINT
    }

    get endpoint() {
        return this._endpoint
    }

    afterDecideResponse(response: DecideResponse) {
        const autocaptureExceptionsResponse = response.autocaptureExceptions

        this._endpoint = isObject(autocaptureExceptionsResponse)
            ? autocaptureExceptionsResponse.endpoint || BASE_ERROR_ENDPOINT
            : BASE_ERROR_ENDPOINT

        if (this.instance.persistence) {
            // when we come to moving the endpoint to not /e/
            // we'll want that to persist between startup and decide response
            // TODO: once BASE_ENDPOINT is no longer /e/ this can be removed
            this.instance.persistence.register({
                [EXCEPTION_CAPTURE_ENDPOINT]: this._endpoint,
            })
        }
    }

    /**
     * :TRICKY: Make sure we batch these requests
     */
    sendExceptionEvent(properties: { [key: string]: any }) {
        this.instance.capture('$exception', properties, {
            _noTruncate: true,
            _batchKey: 'exceptionEvent',
            _url: this.endpoint,
        })
    }
}
