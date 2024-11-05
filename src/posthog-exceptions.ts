import { PostHog } from './posthog-core'
import { Properties } from './types'

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
