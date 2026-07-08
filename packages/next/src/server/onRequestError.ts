import 'server-only'

import { captureNextRequestError } from './captureRequestError.js'
import { getOrCreateNodeClient } from './clientCache.node.js'
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

function isNodeRuntime(): boolean {
    // Next.js sets NEXT_RUNTIME to `edge` or `nodejs` inside instrumentation.
    // In tests or older environments it may be undefined; treat that as Node.
    const runtime = typeof process !== 'undefined' ? process.env.NEXT_RUNTIME : undefined
    return !runtime || runtime === 'nodejs'
}
