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

const statusClass = (status: number | undefined): string => (status ? `${Math.floor(status / 100)}xx` : 'missing')

const networkConfig = (instance: PostHog): NetworkMetricsConfig | undefined => {
    const network = instance.config.metrics?.network
    return network === true ? {} : network || undefined
}

type Observed = { method: string; url: string }

const observe = (method: unknown, url: unknown): Observed => ({
    method: String(method).toUpperCase(),
    url: String(url),
})

type IsActive = () => boolean

const record = (
    instance: PostHog,
    observed: Observed,
    status: number | undefined,
    start: number,
    isActive: IsActive
): void => {
    if (!isActive()) {
        return
    }
    try {
        const config = networkConfig(instance)
        if (!config) {
            return
        }
        // A status of 0 means no response arrived (fetch's opaque no-cors responses report it too),
        // which the callback contract calls `undefined`. Normalised once here for both transports.
        const normalisedStatus = status || undefined
        const durationMs = now() - start
        const url = convertToURL(observed.url)
        const request: NetworkMetricsRequest = { url: url?.href || observed.url, method: observed.method }
        const name = isFunction(config.name)
            ? config.name(request)
            : isString(config.name)
              ? config.name
              : DEFAULT_METRIC_NAME
        if (!name) {
            return
        }
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

const noop = (): void => {}

const patchFetch = (instance: PostHog, isActive: IsActive): (() => void) => {
    if (!isFunction(window?.fetch)) {
        return noop
    }
    return patch(window as any, 'fetch', (originalFetch: any) => {
        return function (this: unknown, ...args: unknown[]) {
            const start = now()
            const result = originalFetch.apply(this, args)
            try {
                const [input, init] = args
                const observed = observe(
                    (init as RequestInit | undefined)?.method ?? (input as Request)?.method ?? 'GET',
                    (input as Request)?.url ?? input
                )
                return result.then(
                    (response: Response) => {
                        record(instance, observed, response?.status, start, isActive)
                        return response
                    },
                    (error: unknown) => {
                        record(instance, observed, undefined, start, isActive)
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

const patchXHR = (instance: PostHog, isActive: IsActive): (() => void) => {
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
                if (observed) {
                    const start = now()
                    onLoadEnd = () => {
                        this.removeEventListener('loadend', onLoadEnd!)
                        record(instance, observed, this.status, start, isActive)
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
 * Records a duration histogram for every `fetch` and `XMLHttpRequest` the page
 * makes, except the SDK's own. Observation only: the wrappers never change the
 * request arguments or its settlement. Fetch returns a derived promise so
 * rejected requests remain observable to the caller and to the browser's
 * unhandled-rejection handling.
 *
 * Each transport is measured to the boundary its API exposes: a `fetch` promise
 * settles when the response headers arrive, and `loadend` fires after the whole
 * XHR response body. Aligning them would mean reading the fetch response body,
 * which an observer must not do.
 *
 * The returned function removes the wrappers. If another wrapper was layered on
 * top and ours cannot be spliced out, it stays in place but records nothing.
 */
export const startNetworkMetrics = (instance: PostHog): (() => void) => {
    let active = true
    const restoreFetch = patchFetch(instance, () => active)
    const restoreXHR = patchXHR(instance, () => active)
    return () => {
        active = false
        restoreFetch()
        restoreXHR()
    }
}
