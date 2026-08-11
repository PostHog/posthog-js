import { convertToURL } from '@posthog/browser-common/utils/request-utils'

import { PostHog } from '../posthog-core'

/**
 * The request router helps simplify the logic to determine which endpoints should be called for which things
 * The basic idea is that for a given region (US or EU), we have a set of endpoints that we should call depending
 * on the type of request (events, replays, flags, etc.) and handle overrides that may come from configs or the flags endpoint
 */

export const RequestRouterRegion = {
    US: 'us',
    EU: 'eu',
    CUSTOM: 'custom',
} as const
export type RequestRouterRegion = (typeof RequestRouterRegion)[keyof typeof RequestRouterRegion]

export type RequestRouterTarget = 'api' | 'ui' | 'assets' | 'flags'

const ingestionDomain = 'i.posthog.com'
const staticAssetPath = /^\/static\//
const ingestionPaths = ['/s/', '/e/', '/i/']

export class RequestRouter {
    instance: PostHog
    private _regionCache: Record<string, RequestRouterRegion> = {}
    private _ingestionEndpoints = new Set<string>()

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

    get flagsApiHost(): string {
        const customHost = this.instance.config.flags_api_host
        if (customHost) {
            return customHost.trim().replace(/\/$/, '')
        }
        // Backwards compatibility: if no custom flags_api_host is set, fall back to the regular apiHost
        return this.apiHost
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

    private _staticAssetHostOverride(path: string): string | undefined {
        if (!staticAssetPath.test(path)) {
            return undefined
        }

        const override = this.instance.config.asset_host
        if (typeof override !== 'string') {
            return undefined
        }

        const normalizedOverride = override.trim().replace(/\/$/, '')
        return normalizedOverride || undefined
    }

    private _urlKey(url: string): string | undefined {
        const parsedUrl = convertToURL(url)
        return parsedUrl ? parsedUrl.protocol + '//' + parsedUrl.host + parsedUrl.pathname : undefined
    }

    private _prepareEndpoint(target: RequestRouterTarget, path: string, url: string): string {
        if (target === 'ui') {
            return url
        }

        let rewrittenUrl = url
        if (this.instance.config.rewrite_request_path) {
            // `URL` is intentionally exposed by this opt-in hook so callers can inspect and update each component safely.
            const resolvedUrl = convertToURL(url)?.href || url
            rewrittenUrl = this.instance.config.rewrite_request_path(new URL(resolvedUrl)).toString()
        }

        if (
            this.instance.config.rewrite_request_path &&
            target === 'api' &&
            ingestionPaths.some((ingestionPath) => path.indexOf(ingestionPath) === 0)
        ) {
            const urlKey = this._urlKey(rewrittenUrl)
            if (urlKey) {
                this._ingestionEndpoints.add(urlKey)
            }
        }

        return rewrittenUrl
    }

    isIngestionEndpoint(url: string): boolean {
        const urlKey = this._urlKey(url)
        return !!urlKey && this._ingestionEndpoints.has(urlKey)
    }

    endpointFor(target: RequestRouterTarget, path: string = ''): string {
        if (path) {
            path = path[0] === '/' ? path : `/${path}`
        }

        if (target === 'ui') {
            return this._prepareEndpoint(target, path, this.uiHost + path)
        }

        if (target === 'flags') {
            return this._prepareEndpoint(target, path, this.flagsApiHost + path)
        }

        if (target === 'assets') {
            const assetHostOverride = this._staticAssetHostOverride(path)
            if (assetHostOverride) {
                return this._prepareEndpoint(target, path, `${assetHostOverride}${path}`)
            }
        }

        if (this.region === RequestRouterRegion.CUSTOM) {
            return this._prepareEndpoint(target, path, this.apiHost + path)
        }

        const suffix = ingestionDomain + path

        switch (target) {
            case 'assets':
                return this._prepareEndpoint(target, path, `https://${this.region}-assets.${suffix}`)
            case 'api':
                return this._prepareEndpoint(target, path, `https://${this.region}.${suffix}`)
        }
    }
}
