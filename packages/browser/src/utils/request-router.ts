import { PostHog } from '../posthog-core'

/**
 * The request router helps simplify the logic to determine which endpoints should be called for which things
 * The basic idea is that for a given region (US or EU), we have a set of endpoints that we should call depending
 * on the type of request (events, replays, flags, etc.) and handle overrides that may come from configs or the flags endpoint
 */

export enum RequestRouterRegion {
    US = 'us',
    EU = 'eu',
    CUSTOM = 'custom',
}

export type RequestRouterTarget = 'api' | 'ui' | 'assets'

const ingestionDomain = 'i.posthog.com'

export class RequestRouter {
    instance: PostHog
    private _regionCache: Record<string, RequestRouterRegion> = {}

    constructor(instance: PostHog) {
        this.instance = instance
    }

    get apiHost(): string {
        const host = this.instance.config.api_host.trim().replace(/\/$/, '')
        if (host === 'https://app.posthog.com') {
            return 'https://us.i.posthog.com'
        }
        return host
    }
    get uiHost(): string | undefined {
        let host = this.instance.config.ui_host?.replace(/\/$/, '')

        if (!host) {
            // No ui_host set, get it from the api_host. But api_host differs
            // from the actual UI host, so replace the ingestion subdomain with just posthog.com
            host = this.apiHost.replace(`.${ingestionDomain}`, '.posthog.com')
        }

        if (host === 'https://app.posthog.com') {
            return 'https://us.posthog.com'
        }

        return host
    }

    get region(): RequestRouterRegion {
        // We don't need to compute this every time so we cache the result
        if (!this._regionCache[this.apiHost]) {
            if (/https:\/\/(app|us|us-assets)(\.i)?\.posthog\.com/i.test(this.apiHost)) {
                this._regionCache[this.apiHost] = RequestRouterRegion.US
            } else if (/https:\/\/(eu|eu-assets)(\.i)?\.posthog\.com/i.test(this.apiHost)) {
                this._regionCache[this.apiHost] = RequestRouterRegion.EU
            } else {
                this._regionCache[this.apiHost] = RequestRouterRegion.CUSTOM
            }
        }
        return this._regionCache[this.apiHost]
    }

    endpointFor(target: RequestRouterTarget, path: string = ''): string {
        if (path) {
            path = path[0] === '/' ? path : `/${path}`
        }

        if (target === 'ui') {
            return this.uiHost + path
        }

        if (this.region === RequestRouterRegion.CUSTOM) {
            return this.apiHost + path
        }

        const suffix = ingestionDomain + path

        switch (target) {
            case 'assets':
                return `https://${this.region}-assets.${suffix}`
            case 'api':
                return `https://${this.region}.${suffix}`
        }
    }
}
