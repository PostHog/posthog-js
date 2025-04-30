import { PostHog } from './posthog-core'
import { Properties } from './types'
import { EXCEPTION_EVENT } from './events'

export class PostHogExceptions {
    constructor(private readonly _instance: PostHog) {}

    /**
     * :TRICKY: Make sure we batch these requests
     */
    sendExceptionEvent(properties: Properties) {
        this._instance.capture(EXCEPTION_EVENT, properties, {
            _noTruncate: true,
            _batchKey: 'exceptionEvent',
        })
    }
}
