import { PostHog } from '../posthog-core'

/**
 * The request router helps simplify the logic to determine which endpoints should be called for which things
 * The basic idea is that for a given region (US or EU), we have a set of endpoints that we should call depending
 * on the type of request (events, replays, decide, etc.) and handle overrides that may come from configs or the decide endpoint
 */

export enum RequestRouterRegion {
    US,
    EU,
    CUSTOM,
}

export enum RequestRouterTarget {
    UI,
    CAPTURE_EVENTS,
    CAPTURE_REPLAY,
    DECIDE,
    API,
}

// DEV NOTES:
// app.posthog.com should become us.i.posthog.com as the base host
// specific endpoints become us-c.i.posthog.com or us-s.i.posthog.com depending on the use case

export class RequestRouter {
    instance: PostHog

    constructor(instance: PostHog) {
        this.instance = instance
    }

    get region(): RequestRouterRegion {
        const apiHost = this.instance.config.api_host.replace(/\/$/, '')

        switch (apiHost) {
            case 'https://app.posthog.com':
            case 'https://us.posthog.com':
                return RequestRouterRegion.US
            case 'https://eu.posthog.com':
                return RequestRouterRegion.EU
            default:
                return RequestRouterRegion.CUSTOM
        }
    }

    endpointFor(target: RequestRouterTarget) {
        let domainSuffix: string | undefined
        let path: string | undefined

        switch (target) {
            case RequestRouterTarget.UI:
                domainSuffix = 'app'
                break
            case RequestRouterTarget.CAPTURE_EVENTS:
                domainSuffix = 'e'
                path = 'e/'
                break
            case RequestRouterTarget.CAPTURE_REPLAY:
                domainSuffix = 'r'
                path = 'r/'
                break
            case RequestRouterTarget.DECIDE:
                domainSuffix = 'decide'
                path = 'decide/'
                break
            case RequestRouterTarget.API:
                domainSuffix = 'api'
                path = 'api/'
                break
        }

        return this.config.api_host + (options.endpoint || this.analyticsDefaultEndpoint)
    }
}
