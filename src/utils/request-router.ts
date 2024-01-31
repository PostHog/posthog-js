import { PostHogConfig } from '../types'

/**
 * The request router helps simplify the logic to determine which endpoints should be called for which things
 * The basic idea is that for a given region (US or EU), we have a set of endpoints that we should call depending
 * on the type of request (events, replays, decide, etc.) and handle overrides that may come from configs or the decide endpoint
 */

export class RequestRouter {
    config: PostHogConfig

    constructor(config: PostHogConfig) {
        this.config = config
    }
}
