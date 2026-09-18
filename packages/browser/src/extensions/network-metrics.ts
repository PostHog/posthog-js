import { isFunction, isString } from '@posthog/core'
import { addEventListener } from '@posthog/browser-common/utils/general-utils'
import { convertToURL } from '@posthog/browser-common/utils/request-utils'
import { window } from '@posthog/browser-common/utils/globals'
import { createLogger } from '@posthog/browser-common/utils/logger'
import type { PostHog } from '../posthog-core'
import { isPostHogXHR } from '../request'
import type { MetricAttributes, NetworkMetricsConfig, NetworkMetricsRequest } from '../types'
import { patch } from './replay/rrweb-plugins/patch'

const logger = createLogger('[NetworkMetrics]')

const DEFAULT_METRIC_NAME = 'http.client.request.duration'

// oxlint-disable-next-line compat/compat
const now = (): number => (window?.performance?.now ? window.performance.now() : Date.now())

// All-digit segments, or hex/uuid-like segments of 8+ characters that contain a digit.
const isIdLikeSegment = (segment: string): boolean =>
    /^\d+$/.test(segment) || (segment.length >= 8 && /^[0-9a-f-]*\d[0-9a-f-]*$/i.test(segment))

const templatePath = (pathname: string): string =>
    pathname
        .split('/')
        .map((segment) => (isIdLikeSegment(segment) ? ':id' : segment))
        .join('/')

const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443 }

const KNOWN_HTTP_METHODS = new Set(['CONNECT', 'DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT', 'TRACE'])

const urlAttributes = (url: HTMLAnchorElement): MetricAttributes => ({
    'server.address':
        url.hostname.startsWith('[') && url.hostname.endsWith(']') ? url.hostname.slice(1, -1) : url.hostname,
    'server.port': Number(url.port) || DEFAULT_PORTS[url.protocol],
    'url.scheme': url.protocol.slice(0, -1),
    'url.template': templatePath(url.pathname),
})

// OTel: a 4xx or 5xx response reports its status as the error type; a request that
// got no response reports the exception name, or `_OTHER` when there is none.
const errorType = (status: number | undefined, failure: unknown): string | undefined => {
    if (status) {
        return status >= 400 ? String(status) : undefined
    }
    return (failure as Error | undefined)?.name || '_OTHER'
}

const methodAttributes = (method: string): MetricAttributes => {
    const original = KNOWN_HTTP_METHODS.has(method) ? method : '_OTHER'
    return {
        'http.request.method': original,
        ...(original === '_OTHER' && method !== original ? { 'http.request.method_original': method } : {}),
    }
}

const networkConfig = (instance: PostHog): NetworkMetricsConfig | undefined => {
    const network = instance.config.metrics?.network
    return network === true ? {} : network || undefined
}

type Observed = { method: string; url: string }

const observe = (method: unknown, url: unknown): Observed => {
    const observedUrl = String(url)
    return {
        method: String(method).toUpperCase(),
        url: convertToURL(observedUrl)?.href || observedUrl,
    }
}

// The config while the wrapper should observe requests, `undefined` once it is stopped or turned off.
type Enabled = () => NetworkMetricsConfig | undefined

const record = (
    instance: PostHog,
    observed: Observed,
    status: number | undefined,
    start: number,
    enabled: Enabled,
    failure?: unknown,
    fulfilled = false
): void => {
    try {
        const config = enabled()
        if (!config) {
            return
        }
        // A status of 0 means no response arrived (fetch's opaque no-cors responses report it too),
        // which the callback contract calls `undefined`. Normalised once here for both transports.
        const normalisedStatus = status || undefined
        const durationMs = now() - start
        const url = convertToURL(observed.url)
        if (url && url.protocol !== 'http:' && url.protocol !== 'https:') {
            return
        }
        const request: NetworkMetricsRequest = { url: url?.href || observed.url, method: observed.method }
        const name = isFunction(config.name)
            ? config.name(request)
            : isString(config.name)
              ? config.name
              : DEFAULT_METRIC_NAME
        if (!name) {
            return
        }
        const error = fulfilled && !normalisedStatus ? undefined : errorType(normalisedStatus, failure)
        const attributes: MetricAttributes = {
            ...methodAttributes(request.method),
            ...(url ? urlAttributes(url) : {}),
            ...(normalisedStatus ? { 'http.response.status_code': normalisedStatus } : {}),
            ...(error ? { 'error.type': error } : {}),
            ...config.attributes?.(request, { status: normalisedStatus, durationMs }),
        }
        instance.metrics?.histogram(name, durationMs, { unit: 'ms', attributes })
    } catch (e) {
        logger.error('Failed to record network metric', e)
    }
}

const noop = (): void => {}

const patchFetch = (instance: PostHog, enabled: Enabled): (() => void) => {
    if (!isFunction(window?.fetch)) {
        return noop
    }
    return patch(window as any, 'fetch', (originalFetch: any) => {
        return function (this: unknown, ...args: unknown[]) {
            const start = now()
            const result = originalFetch.apply(this, args)
            if (!enabled()) {
                return result
            }
            try {
                const [input, init] = args
                const observed = observe(
                    (init as RequestInit | undefined)?.method ?? (input as Request)?.method ?? 'GET',
                    (input as Request)?.url ?? input
                )
                return result.then(
                    (response: Response) => {
                        record(instance, observed, response?.status, start, enabled, undefined, true)
                        return response
                    },
                    (error: unknown) => {
                        record(instance, observed, undefined, start, enabled, error)
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

const patchXHR = (instance: PostHog, enabled: Enabled): (() => void) => {
    const prototype = window?.XMLHttpRequest?.prototype
    if (!prototype) {
        return noop
    }
    const requests = new WeakMap<XMLHttpRequest, Observed>()

    const restoreOpen = patch(prototype, 'open', (originalOpen: any) => {
        return function (this: XMLHttpRequest, ...args: unknown[]) {
            try {
                if (!isPostHogXHR(this)) {
                    requests.set(this, observe(args[0], args[1]))
                }
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
                const observed = requests.get(this)
                if (observed && enabled()) {
                    const start = now()
                    onLoadEnd = () => {
                        this.removeEventListener('loadend', onLoadEnd!)
                        record(instance, observed, this.status, start, enabled)
                    }
                    addEventListener(this as unknown as Element, 'loadend', onLoadEnd)
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
        restoreOpen()
        restoreSend()
    }
}

/**
 * Records a duration histogram for every HTTP or HTTPS `fetch` and
 * `XMLHttpRequest` the page makes, except the SDK's own. Observation only: the
 * wrappers never change the request arguments or its settlement. Fetch returns
 * a derived promise so rejected requests remain observable to the caller and to
 * the browser's unhandled-rejection handling.
 *
 * Each transport is measured to the boundary its API exposes: a `fetch` promise
 * settles when the response headers arrive, and `loadend` fires after the whole
 * XHR response body. Aligning them would mean reading the fetch response body,
 * which an observer must not do.
 *
 * While `metrics.network` is off the wrappers pass every request straight
 * through. The returned function removes them; if another wrapper was layered
 * on top and ours cannot be spliced out, it stays in place as a pass-through.
 */
export const startNetworkMetrics = (instance: PostHog): (() => void) => {
    let active = true
    const enabled: Enabled = () => (active ? networkConfig(instance) : undefined)
    const restoreFetch = patchFetch(instance, enabled)
    const restoreXHR = patchXHR(instance, enabled)
    return () => {
        active = false
        restoreFetch()
        restoreXHR()
    }
}
