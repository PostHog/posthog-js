import { isFunction, isString, isUndefined } from '@posthog/core'
import { addEventListener } from '@posthog/browser-common/utils/general-utils'
import { convertToURL } from '@posthog/browser-common/utils/request-utils'
import { window } from '@posthog/browser-common/utils/globals'
import { createLogger } from '@posthog/browser-common/utils/logger'
import type { PostHog } from '../posthog-core'
import type { MetricAttributes, NetworkMetricsConfig, NetworkMetricsRequest } from '../types'
import { patch } from './replay/rrweb-plugins/patch'

const logger = createLogger('[NetworkMetrics]')

const DEFAULT_METRIC_NAME = 'http.client.request.duration'

// oxlint-disable-next-line compat/compat
const now = (): number => (window?.performance?.now ? window.performance.now() : Date.now())

// All-digit segments, or hex/uuid-like segments of 8+ characters that contain a digit.
const isIdLikeSegment = (segment: string): boolean =>
    /^\d+$/.test(segment) || (segment.length >= 8 && /^[0-9a-f-]*\d[0-9a-f-]*$/i.test(segment))

const templateSegment = (segment: string): string => {
    if (isIdLikeSegment(segment)) {
        return ':id'
    }

    // Keep file extensions and stable prefixes while still collapsing the variable part of
    // paths such as `/invoices/38217.pdf` and `/customers/cus_a1b2c3d4e5`.
    const idWithSuffix = /^(.*(?:[_-]))((?:\d+|[0-9a-f-]*\d[0-9a-f-]*))(\.[^./]+)?$/i.exec(segment)
    if (idWithSuffix) {
        return `${idWithSuffix[1]}:id${idWithSuffix[3] || ''}`
    }

    const idWithExtension = /^(\d+|[0-9a-f-]*\d[0-9a-f-]*)(\.[^./]+)$/i.exec(segment)
    return idWithExtension ? `:id${idWithExtension[2]}` : segment
}

const templatePath = (pathname: string): string => pathname.split('/').map(templateSegment).join('/')

const statusClass = (status: number | undefined): string => (status ? `${Math.floor(status / 100)}xx` : 'error')

const toAbsoluteUrl = (url: string): string => convertToURL(url)?.href || url

const toRequest = (method: unknown, url: unknown): NetworkMetricsRequest => ({
    url: toAbsoluteUrl(String(url)),
    method: String(method).toUpperCase(),
})

// `api_host` may be a relative proxy path like `/ingest`, so resolve it the same way as the request url.
// The match stops at a path boundary: with `api_host: '/ingest'`, `/ingest/e/` belongs to PostHog but the
// application's own `/ingestion-status` does not. A host root matches that whole origin, which is what the
// subdomain and cloud setups need.
const isUnderEndpoint = (url: string, endpoint: string): boolean => {
    const base = toAbsoluteUrl(endpoint).replace(/\/$/, '')
    return url === base || url.indexOf(base + '/') === 0 || url.indexOf(base + '?') === 0
}

const SAME_ORIGIN_API_PATHS = [
    '/e/',
    '/i/',
    '/s/',
    '/i/v1/',
    '/api/surveys/',
    '/api/early_access_features/',
    '/api/web_experiments/',
    '/api/product_tours/',
    '/api/conversations/',
]
const SAME_ORIGIN_FLAGS_PATHS = ['/flags/']
const SAME_ORIGIN_ASSET_PATHS = ['/array/', '/static/']
const SAME_ORIGIN_UI_PATHS = ['/project/', '/toolbar/']

const isPageOriginRoot = (endpoint: string): boolean => {
    const parsedEndpoint = convertToURL(endpoint)
    return (
        !!parsedEndpoint &&
        parsedEndpoint.pathname === '/' &&
        !parsedEndpoint.search &&
        !parsedEndpoint.hash &&
        parsedEndpoint.origin === window?.location?.origin
    )
}

const isConfiguredEndpoint = (
    instance: PostHog,
    target: 'api' | 'flags' | 'assets' | 'ui',
    url: string,
    sameOriginPaths: string[]
): boolean => {
    const router = instance.requestRouter
    const endpoint = router.endpointFor(target)
    if (!isPageOriginRoot(endpoint)) {
        return isUnderEndpoint(url, endpoint)
    }

    return sameOriginPaths.some((path) => isUnderEndpoint(url, router.endpointFor(target, path)))
}

const isPostHogRequest = (instance: PostHog, url: string): boolean => {
    const router = instance.requestRouter
    return (
        isConfiguredEndpoint(instance, 'api', url, [
            ...SAME_ORIGIN_API_PATHS,
            ...(instance.analyticsDefaultEndpoint ? [instance.analyticsDefaultEndpoint] : []),
        ]) ||
        isConfiguredEndpoint(instance, 'flags', url, SAME_ORIGIN_FLAGS_PATHS) ||
        // the asset host serves the remote config JSON fallback, which travels over fetch or XHR
        isConfiguredEndpoint(instance, 'assets', url, SAME_ORIGIN_ASSET_PATHS) ||
        isConfiguredEndpoint(instance, 'ui', url, SAME_ORIGIN_UI_PATHS) ||
        router.isIngestionEndpoint(url)
    )
}

const networkConfig = (instance: PostHog): NetworkMetricsConfig | undefined => {
    const network = instance.config.metrics?.network
    return network === true ? {} : network || undefined
}

type NetworkMetricsState = {
    instances: Map<PostHog, number>
    restoreFetch: () => boolean
    restoreXHR: () => boolean
    opaqueFetchSource?: unknown
    opaqueXHROpenSource?: unknown
    opaqueXHRSendSource?: unknown
}

let sharedNetworkMetrics: NetworkMetricsState | undefined

const enabledInstances = (state: NetworkMetricsState): PostHog[] =>
    Array.from(state.instances.keys()).filter((instance) => !!networkConfig(instance))

const record = (
    state: NetworkMetricsState,
    request: NetworkMetricsRequest,
    status: number | undefined,
    start: number
): void => {
    const instances = enabledInstances(state)
    const instance = instances[0]
    if (!instance || instances.some((activeInstance) => isPostHogRequest(activeInstance, request.url))) {
        return
    }
    try {
        // A status of 0 means no response arrived (fetch's opaque no-cors responses report it too),
        // which the callback contract calls `undefined`. Normalised once here for both transports.
        const normalisedStatus = status || undefined
        const durationMs = now() - start
        const config = networkConfig(instance)
        if (!config) {
            return
        }
        const name = isFunction(config.name)
            ? config.name(request)
            : isString(config.name)
              ? config.name
              : DEFAULT_METRIC_NAME
        if (!name) {
            return
        }
        const url = convertToURL(request.url)
        const attributes: MetricAttributes = {
            method: request.method,
            host: url?.hostname ?? '',
            path: url ? templatePath(url.pathname) : '',
            status_class: statusClass(normalisedStatus),
            ...config.attributes?.(request, { status: normalisedStatus, durationMs }),
        }
        instance.metrics?.histogram(name, durationMs, { unit: 'ms', attributes })
    } catch (e) {
        logger.error('Failed to record network metric', e)
    }
}

const noPatch = (): boolean => true

const patchFetch = (state: NetworkMetricsState): (() => boolean) => {
    if (!isFunction(window?.fetch)) {
        return noPatch
    }
    return patch(window as any, 'fetch', (originalFetch: any) => {
        return function (this: unknown, ...args: unknown[]) {
            const start = now()
            const result = originalFetch.apply(this, args)
            try {
                const [input, init] = args
                const request = toRequest(
                    (init as RequestInit | undefined)?.method ?? (input as Request)?.method ?? 'GET',
                    (input as Request)?.url ?? input
                )
                return result.then(
                    (response: Response) => {
                        record(state, request, response?.status, start)
                        return response
                    },
                    (error: unknown) => {
                        record(state, request, undefined, start)
                        throw error
                    }
                )
            } catch (e) {
                logger.error('Failed to observe fetch', e)
                return result
            }
        }
    })
}

const patchXHR = (state: NetworkMetricsState): (() => boolean) => {
    const prototype = window?.XMLHttpRequest?.prototype
    if (!prototype) {
        return noPatch
    }
    const requests = new WeakMap<XMLHttpRequest, NetworkMetricsRequest>()

    const restoreOpen = patch(prototype, 'open', (originalOpen: any) => {
        return function (this: XMLHttpRequest, ...args: unknown[]) {
            try {
                requests.set(this, toRequest(args[0], args[1]))
            } catch (e) {
                logger.error('Failed to observe XHR open', e)
            }
            return originalOpen.apply(this, args)
        }
    })
    const restoreSend = patch(prototype, 'send', (originalSend: any) => {
        return function (this: XMLHttpRequest, ...args: unknown[]) {
            let onLoadEnd: (() => void) | undefined
            try {
                const request = requests.get(this)
                if (request) {
                    const start = now()
                    const loadEndListener = () => {
                        this.removeEventListener('loadend', loadEndListener)
                        // XHR reports status 0 when no response arrived, which the callback contract calls `undefined`.
                        record(state, request, this.status, start)
                    }
                    onLoadEnd = loadEndListener
                    addEventListener(this as unknown as Element, 'loadend', loadEndListener)
                }
            } catch (e) {
                logger.error('Failed to observe XHR send', e)
            }
            try {
                return originalSend.apply(this, args)
            } catch (e) {
                if (onLoadEnd) {
                    this.removeEventListener('loadend', onLoadEnd)
                }
                throw e
            }
        }
    })

    return () => {
        const openRemoved = restoreOpen()
        const sendRemoved = restoreSend()
        return openRemoved && sendRemoved
    }
}

const createNetworkMetricsState = (): NetworkMetricsState => {
    const state = {
        instances: new Map<PostHog, number>(),
        restoreFetch: noPatch,
        restoreXHR: noPatch,
    }
    state.restoreFetch = patchFetch(state)
    state.restoreXHR = patchXHR(state)
    return state
}

const stopSharedNetworkMetrics = (state: NetworkMetricsState): void => {
    const fetchRemoved = state.restoreFetch()
    const xhrRemoved = state.restoreXHR()
    // A third-party wrapper may have closed over our function, making it impossible to splice
    // out safely. Keep the shared state in that case so a later enable reuses the same observer
    // instead of stacking another one beneath the opaque wrapper.
    state.opaqueFetchSource = fetchRemoved ? undefined : window?.fetch
    state.opaqueXHROpenSource = xhrRemoved ? undefined : window?.XMLHttpRequest?.prototype.open
    state.opaqueXHRSendSource = xhrRemoved ? undefined : window?.XMLHttpRequest?.prototype.send
    if (fetchRemoved && xhrRemoved && sharedNetworkMetrics === state) {
        sharedNetworkMetrics = undefined
    }
}

const sharedNetworkMetricsIsDetached = (state: NetworkMetricsState): boolean =>
    (!isUndefined(state.opaqueFetchSource) && window?.fetch !== state.opaqueFetchSource) ||
    (!isUndefined(state.opaqueXHROpenSource) && window?.XMLHttpRequest?.prototype.open !== state.opaqueXHROpenSource) ||
    (!isUndefined(state.opaqueXHRSendSource) && window?.XMLHttpRequest?.prototype.send !== state.opaqueXHRSendSource)

/**
 * Records a duration histogram for every `fetch` and `XMLHttpRequest`.
 * Observation only: the wrappers never change the request arguments or its
 * settlement. Fetch returns a derived promise so rejected requests remain
 * observable to the caller and to the browser's unhandled-rejection handling.
 *
 * Each transport is measured to the boundary its API exposes: a `fetch` promise
 * settles when the response headers arrive, and `loadend` fires after the whole
 * XHR response body. Aligning them would mean reading the fetch response body,
 * which an observer must not do.
 */
export const startNetworkMetrics = (instance: PostHog): (() => void) => {
    if (
        sharedNetworkMetrics &&
        sharedNetworkMetrics.instances.size === 0 &&
        sharedNetworkMetricsIsDetached(sharedNetworkMetrics)
    ) {
        sharedNetworkMetrics = undefined
    }
    const state = sharedNetworkMetrics || (sharedNetworkMetrics = createNetworkMetricsState())
    state.instances.set(instance, (state.instances.get(instance) || 0) + 1)
    let active = true
    return () => {
        if (!active) {
            return
        }
        active = false
        const count = state.instances.get(instance)
        if (count && count > 1) {
            state.instances.set(instance, count - 1)
        } else {
            state.instances.delete(instance)
        }
        if (state.instances.size === 0) {
            stopSharedNetworkMetrics(state)
        }
    }
}
