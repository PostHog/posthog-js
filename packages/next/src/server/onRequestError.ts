import 'server-only'

import { captureNextRequestError, sendNextRequestError } from './captureRequestError.js'
import { getOrCreateNodeClient } from './clientCache.node.js'
import { wrapProxy } from './withPostHogProxy.js'
import type { NextProxyHandler } from './withPostHogProxy.js'
import type {
    NextOnRequestError,
    NextRequestErrorContext,
    NextRequestErrorRequest,
    OnRequestErrorOptions,
} from './onRequestError.types.js'

export type {
    NextOnRequestError,
    NextRequestError,
    NextRequestErrorContext,
    NextRequestErrorRequest,
    OnRequestErrorBeforeCaptureContext,
    OnRequestErrorOptions,
} from './onRequestError.types.js'

/**
 * Creates a Next.js instrumentation `onRequestError` handler that captures
 * server-side errors with `posthog-node`.
 *
 * @example
 * ```ts
 * // instrumentation.ts
 * export { onRequestError } from '@posthog/next'
 * ```
 */
export function createOnRequestError(options: OnRequestErrorOptions = {}): NextOnRequestError {
    return (error, request, context) => captureRequestError(error, request, context, options)
}

/**
 * Captures a Next.js server-side request error with `posthog-node`.
 */
export async function captureRequestError(
    error: unknown,
    request: NextRequestErrorRequest,
    context: NextRequestErrorContext,
    options: OnRequestErrorOptions = {}
): Promise<void> {
    if (!isNodeRuntime()) {
        return
    }

    await captureNextRequestError(error, request, context, options, getOrCreateNodeClient)
}

/**
 * Default Next.js instrumentation hook. Export this from `instrumentation.ts`
 * to capture server-side errors by default.
 */
export const onRequestError: NextOnRequestError = captureRequestError

/**
 * Wraps a Next.js `proxy` (or `middleware`) function to capture the errors it throws with
 * `posthog-node`, then rethrows them. Next.js 16 does not report `proxy.ts` errors to
 * `onRequestError`, and Next.js 15 does not report Node.js middleware errors. Where Next.js
 * does report the error as well, `onRequestError` skips it, so it is captured once.
 *
 * The error is rethrown at once, so the response does not wait for PostHog. The capture is
 * handed to `event.waitUntil`, which keeps a serverless function running for it for up to
 * 2 seconds. Each failing request is captured once, also when many throw one error object.
 *
 * @example
 * ```ts
 * // proxy.ts
 * import { withPostHogProxy } from '@posthog/next'
 *
 * export const proxy = withPostHogProxy(async (request) => {
 *     // ...
 * })
 * ```
 */
export function withPostHogProxy<TResult>(
    proxy: NextProxyHandler<TResult>,
    options: OnRequestErrorOptions = {}
): NextProxyHandler<Promise<Awaited<TResult>>> {
    return wrapProxy(proxy, (error, request, context) =>
        !options.disabled && isNodeRuntime()
            ? sendNextRequestError(error, request, context, options, getOrCreateNodeClient)
            : undefined
    )
}

function isNodeRuntime(): boolean {
    // Next.js sets NEXT_RUNTIME to `edge` or `nodejs` inside instrumentation.
    // In tests or older environments it may be undefined; treat that as Node.
    const runtime = typeof process !== 'undefined' ? process.env.NEXT_RUNTIME : undefined
    return !runtime || runtime === 'nodejs'
}
