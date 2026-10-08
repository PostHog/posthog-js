import { isUndefined } from '@posthog/core'
import { userAgent } from '@posthog/browser-common/utils/globals'
import type { PostHog } from './posthog-core'
import type { QueuedRequestWithOptions } from './types'
import { request, SUPPORTS_REQUEST } from './request'
import type { TransportCallback } from './request'

/*
 * Dynamic... constants? Is that an oxymoron?
 */
// http://hacks.mozilla.org/2009/07/cross-site-xmlhttprequest-with-cors/
// https://developer.mozilla.org/en-US/docs/DOM/XMLHttpRequest#withCredentials

// IE<10 does not support cross-origin XHR's but script tags
// with defer won't block window.onload; ENQUEUE_REQUESTS
// should only be true for Opera<12
let ENQUEUE_REQUESTS = !SUPPORTS_REQUEST && userAgent?.indexOf('MSIE') === -1 && userAgent?.indexOf('Mozilla') === -1

export function enableRequestSending(): void {
    ENQUEUE_REQUESTS = false
}

// Internal dispatch shared by PostHog and RetryQueue. Transport metadata never enters
// RequestResponse or the public options/callback contract.
export function sendRequest(
    instance: PostHog,
    options: QueuedRequestWithOptions,
    onResponse?: TransportCallback
): void {
    if (onResponse) {
        // Drop callbacks and DOM-ready deferral retain a one-argument completion.
        // A deferred request is drained through a fresh RetryQueue attempt, which
        // owns the eventual transport's Retry-After delay.
        options = { ...options, callback: (response) => onResponse(response) }
    }
    if (!instance.__loaded) {
        if (options.fireCallbackOnDrop) {
            options.callback?.({ statusCode: 0 })
        }
        return
    }

    if (ENQUEUE_REQUESTS) {
        instance.__request_queue.push(options)
        return
    }

    if (instance.rateLimiter.isServerRateLimited(options.batchKey)) {
        if (options.fireCallbackOnDrop) {
            options.callback?.({ statusCode: 429 })
        }
        return
    }

    options.transport = options.transport || instance.config.api_transport
    options.headers = {
        ...instance.config.request_headers,
        ...options.headers,
    }
    options.compression =
        options.compression === 'best-available'
            ? (instance.compression ?? options.compressionFallback)
            : options.compression
    const disableBeacon = isUndefined(instance.config.disable_beacon)
        ? instance.config.__preview_disable_beacon
        : instance.config.disable_beacon
    if (disableBeacon) {
        options.disableTransport = ['sendBeacon']
    }

    // Specially useful if you're doing SSR with NextJS
    // Users must be careful when tweaking `cache` because they might get out-of-date feature flags
    options.fetchOptions = options.fetchOptions || instance.config.fetch_options

    request(options, (response, retryAfterMs) => {
        instance.rateLimiter.checkForLimiting(response)

        if (response.statusCode >= 400) {
            instance.config.on_request_error?.(response)
        }

        if (onResponse) {
            onResponse(response, retryAfterMs)
        } else {
            options.callback?.(response)
        }
    })
}
