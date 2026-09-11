import { isFunction, isString } from '@posthog/core'
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

const templatePath = (pathname: string): string =>
    pathname
        .split('/')
        .map((segment) => (isIdLikeSegment(segment) ? ':id' : segment))
        .join('/')

const statusClass = (status: number | undefined): string => (status ? `${Math.floor(status / 100)}xx` : 'error')

const toAbsoluteUrl = (url: string): string => convertToURL(url)?.href || url

const toRequest = (method: unknown, url: unknown): NetworkMetricsRequest => ({
    url: toAbsoluteUrl(String(url)),
    method: String(method).toUpperCase(),
})

// `api_host` may be a relative proxy path like `/ingest`, so resolve it the same way as the request url.
const isPostHogRequest = (instance: PostHog, url: string): boolean => {
    const router = instance.requestRouter
    return (
        url.indexOf(toAbsoluteUrl(router.endpointFor('api'))) === 0 ||
        url.indexOf(toAbsoluteUrl(router.endpointFor('flags'))) === 0 ||
        router.isIngestionEndpoint(url)
    )
}

const networkConfig = (instance: PostHog): NetworkMetricsConfig | undefined => {
    const network = instance.config.metrics?.network
    return network === true ? {} : network || undefined
}

const record = (instance: PostHog, request: NetworkMetricsRequest, status: number | undefined, start: number): void => {
    try {
        const durationMs = now() - start
        const config = networkConfig(instance)
        if (!config || isPostHogRequest(instance, request.url)) {
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
            status_class: statusClass(status),
            ...config.attributes?.(request, { status, durationMs }),
        }
        instance.metrics?.histogram(name, durationMs, { unit: 'ms', attributes })
    } catch (e) {
        logger.error('Failed to record network metric', e)
    }
}

const noop = (): void => {}

const patchFetch = (instance: PostHog): (() => void) => {
    if (!isFunction(window?.fetch)) {
        return noop
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
                result.then(
                    (response: Response) => record(instance, request, response?.status, start),
                    () => record(instance, request, undefined, start)
                )
            } catch (e) {
                logger.error('Failed to observe fetch', e)
            }
            return result
        }
    })
}

const patchXHR = (instance: PostHog): (() => void) => {
    const prototype = window?.XMLHttpRequest?.prototype
    if (!prototype) {
        return noop
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
            try {
                const request = requests.get(this)
                if (request) {
                    const start = now()
                    const onLoadEnd = () => {
                        this.removeEventListener('loadend', onLoadEnd)
                        // XHR reports status 0 when no response arrived, which the callback contract calls `undefined`.
                        record(instance, request, this.status || undefined, start)
                    }
                    addEventListener(this as unknown as Element, 'loadend', onLoadEnd)
                }
            } catch (e) {
                logger.error('Failed to observe XHR send', e)
            }
            return originalSend.apply(this, args)
        }
    })

    return () => {
        restoreOpen()
        restoreSend()
    }
}

/**
 * Records a duration histogram for every `fetch` and `XMLHttpRequest`.
 * Observation only: the wrappers never change the arguments or the result,
 * and every failure inside them is caught and logged.
 *
 * Each transport is measured to the boundary its API exposes: a `fetch` promise
 * settles when the response headers arrive, and `loadend` fires after the whole
 * XHR response body. Aligning them would mean reading the fetch response body,
 * which an observer must not do.
 */
export const startNetworkMetrics = (instance: PostHog): (() => void) => {
    const restoreFetch = patchFetch(instance)
    const restoreXHR = patchXHR(instance)
    return () => {
        restoreFetch()
        restoreXHR()
    }
}
