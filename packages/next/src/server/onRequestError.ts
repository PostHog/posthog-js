import 'server-only'

import { captureNextRequestError } from './captureRequestError.js'
import { getOrCreateNodeClient } from './clientCache.node.js'
import { wrapProxy } from './withPostHogProxy.js'
import type { NextProxyArgs } from './withPostHogProxy.js'
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
 * `posthog-node`, then rethrows them. Next.js 16 does not report proxy errors to
 * `onRequestError`. Errors it captures are marked, so `onRequestError` skips them.
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
export function withPostHogProxy<TArgs extends NextProxyArgs, TResult>(
    proxy: (...args: TArgs) => TResult,
    options: OnRequestErrorOptions = {}
): (...args: TArgs) => Promise<Awaited<TResult>> {
    return wrapProxy(proxy, options, captureRequestError)
}

function isNodeRuntime(): boolean {
    // Next.js sets NEXT_RUNTIME to `edge` or `nodejs` inside instrumentation.
    // In tests or older environments it may be undefined; treat that as Node.
    const runtime = typeof process !== 'undefined' ? process.env.NEXT_RUNTIME : undefined
    return !runtime || runtime === 'nodejs'
}
