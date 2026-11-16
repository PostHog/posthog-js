import { captureNextRequestError, sendNextRequestError } from './server/captureRequestError.js'
import { getOrCreateEdgeClient } from './server/clientCache.edge.js'
import { wrapProxy } from './server/withPostHogProxy.js'
import type { NextProxyHandler } from './server/withPostHogProxy.js'
import type {
    NextOnRequestError,
    NextRequestErrorContext,
    NextRequestErrorRequest,
    OnRequestErrorOptions,
} from './server/onRequestError.types.js'

/**
 * Creates an edge-safe Next.js instrumentation `onRequestError` handler that
 * captures server-side errors with the edge build of `posthog-node`.
 */
export function createOnRequestError(options: OnRequestErrorOptions = {}): NextOnRequestError {
    return (error, request, context) => captureRequestError(error, request, context, options)
}

/**
 * Captures a Next.js server-side request error in the Edge runtime.
 */
export async function captureRequestError(
    error: unknown,
    request: NextRequestErrorRequest,
    context: NextRequestErrorContext,
    options: OnRequestErrorOptions = {}
): Promise<void> {
    await captureNextRequestError(error, request, context, options, getOrCreateEdgeClient)
}

export const onRequestError: NextOnRequestError = captureRequestError

/**
 * Wraps a Next.js `proxy` (or `middleware`) function to capture the errors it throws with the
 * edge build of `posthog-node`, then rethrows them. Where Next.js reports the error to
 * `onRequestError` as well, `onRequestError` skips it, so it is captured once.
 *
 * The error is rethrown at once, so the response does not wait for PostHog. The capture is
 * handed to `event.waitUntil`, which keeps a serverless function running for it for up to
 * 2 seconds. Each failing request is captured once, also when many throw one error object.
 */
export function withPostHogProxy<TResult>(
    proxy: NextProxyHandler<TResult>,
    options: OnRequestErrorOptions = {}
): NextProxyHandler<Promise<Awaited<TResult>>> {
    return wrapProxy(proxy, (error, request, context) =>
        options.disabled ? undefined : sendNextRequestError(error, request, context, options, getOrCreateEdgeClient)
    )
}

export type {
    NextOnRequestError,
    NextRequestError,
    NextRequestErrorContext,
    NextRequestErrorRequest,
    OnRequestErrorBeforeCaptureContext,
    OnRequestErrorOptions,
} from './server/onRequestError.types.js'
