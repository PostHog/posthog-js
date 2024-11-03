import { PostHog } from './posthog-core'
import { Properties } from './types'

// TODO: move this to /x/ as default
export const BASE_ERROR_ENDPOINT_SUFFIX = '/e/'

export class PostHogExceptions {
    constructor(private readonly instance: PostHog) {}

    /**
     * :TRICKY: Make sure we batch these requests
     */
    sendExceptionEvent(properties: Properties) {
        this.instance.capture('$exception', properties, {
            _noTruncate: true,
            _batchKey: 'exceptionEvent',
        })
    }
}
