import { PostHog } from '../posthog-core'

/**
 * The request router helps simplify the logic to determine which endpoints should be called for which things
 * The basic idea is that for a given region (US or EU), we have a set of endpoints that we should call depending
 * on the type of request (events, replays, decide, etc.) and handle overrides that may come from configs or the decide endpoint
 */

export enum RequestRouterRegion {
    US = 'us',
    EU = 'eu',
    CUSTOM = 'custom',
}

export type RequestRouterTarget = 'api' | 'ui' | 'assets'

export class RequestRouter {
    instance: PostHog

    constructor(instance: PostHog) {
        this.instance = instance
    }

    get apiHost(): string {
        return this.instance.config.api_host.trim().replace(/\/$/, '')
    }
    get uiHost(): string | undefined {
        return this.instance.config.ui_host?.replace(/\/$/, '')
    }

    get region(): RequestRouterRegion {
        switch (this.apiHost) {
            case 'https://app.posthog.com':
            case 'https://us.posthog.com':
                return RequestRouterRegion.US
            case 'https://eu.posthog.com':
                return RequestRouterRegion.EU
            default:
                return RequestRouterRegion.CUSTOM
        }
    }

    endpointFor(target: RequestRouterTarget, path: string = ''): string {
        if (path) {
            path = path[0] === '/' ? path : `/${path}`
        }

        if (target === 'ui') {
            return (this.uiHost || this.apiHost) + path
        }

        if (this.region === RequestRouterRegion.CUSTOM) {
            return this.apiHost + path
        }

        const suffix = 'i.posthog.com' + path

        switch (target) {
            case 'assets':
                return `https://${this.region}-assets.${suffix}`
            case 'api':
                return `https://${this.region}.${suffix}`
        }
    }
}
