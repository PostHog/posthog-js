import { EXCEPTION_CAPTURE_ENDPOINT_SUFFIX } from './constants'
import { PostHog } from './posthog-core'
import { DecideResponse, Properties } from './types'
import { isObject } from './utils/type-utils'

// TODO: move this to /x/ as default
export const BASE_ERROR_ENDPOINT_SUFFIX = '/e/'

export class PostHogExceptions {
    private _endpointSuffix: string

    constructor(private readonly instance: PostHog) {
        // TODO: once BASE_ERROR_ENDPOINT_SUFFIX is no longer /e/ this can be removed
        this._endpointSuffix =
            this.instance.persistence?.props[EXCEPTION_CAPTURE_ENDPOINT_SUFFIX] || BASE_ERROR_ENDPOINT_SUFFIX
    }

    get endpoint() {
        // Always respect any api_host set by the client config
        return this.instance.requestRouter.endpointFor('api', this._endpointSuffix)
    }

    afterDecideResponse(response: DecideResponse) {
        const autocaptureExceptionsResponse = response.autocaptureExceptions

        this._endpointSuffix = isObject(autocaptureExceptionsResponse)
            ? autocaptureExceptionsResponse.endpoint || BASE_ERROR_ENDPOINT_SUFFIX
            : BASE_ERROR_ENDPOINT_SUFFIX

        if (this.instance.persistence) {
            // when we come to moving the endpoint to not /e/
            // we'll want that to persist between startup and decide response
            // TODO: once BASE_ENDPOINT is no longer /e/ this can be removed
            this.instance.persistence.register({
                [EXCEPTION_CAPTURE_ENDPOINT_SUFFIX]: this._endpointSuffix,
            })
        }
    }

    /**
     * :TRICKY: Make sure we batch these requests
     */
    sendExceptionEvent(properties: Properties) {
        this.instance.capture('$exception', properties, {
            _noTruncate: true,
            _batchKey: 'exceptionEvent',
            _url: this.endpoint,
        })
    }
}
