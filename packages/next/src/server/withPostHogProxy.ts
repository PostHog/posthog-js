import { isFunction } from '@posthog/core'
import { isNextControlFlowError } from '../shared/identity.js'
import { markErrorAsCaptured } from './captureRequestError.js'
import type { NextRequestErrorContext, NextRequestErrorRequest, OnRequestErrorOptions } from './onRequestError.types.js'

/** The arguments Next.js passes to a proxy (middleware) function: the request, then for example the fetch event. */
export type NextProxyArgs = [request: Request, ...rest: unknown[]]

type CaptureRequestError = (
    error: unknown,
    request: NextRequestErrorRequest,
    context: NextRequestErrorContext,
    options?: OnRequestErrorOptions
) => Promise<void>

export function wrapProxy<TArgs extends NextProxyArgs, TResult>(
    proxy: (...args: TArgs) => TResult,
    options: OnRequestErrorOptions,
    captureRequestError: CaptureRequestError
): (...args: TArgs) => Promise<Awaited<TResult>> {
    return async (...args: TArgs): Promise<Awaited<TResult>> => {
        try {
            return await proxy(...args)
        } catch (error) {
            if (!isNextControlFlowError(error)) {
                await captureProxyError(error, args[0], options, captureRequestError)
            }
            throw error
        }
    }
}

async function captureProxyError(
    error: unknown,
    request: Request,
    options: OnRequestErrorOptions,
    captureRequestError: CaptureRequestError
): Promise<void> {
    try {
        await captureRequestError(
            error,
            toRequestErrorRequest(request),
            { routePath: '/proxy', routeType: 'proxy' },
            options
        )
    } catch {
        // Capture failures are already reported; the proxy error must still reach Next.js.
    }
    // Next.js 15 and earlier also report edge middleware errors to onRequestError, which skips marked errors.
    markErrorAsCaptured(error)
}

// Matches the request shape Next.js passes to onRequestError for middleware errors.
function toRequestErrorRequest(request: Request | undefined): NextRequestErrorRequest {
    const headers: Record<string, string> = {}
    if (request && isFunction(request.headers?.forEach)) {
        request.headers.forEach((value, name) => {
            headers[name] = value
        })
    }

    return {
        headers,
        method: request?.method,
        path: getPathWithSearch(request?.url),
        url: request?.url,
    }
}

function getPathWithSearch(url: string | undefined): string | undefined {
    if (!url) {
        return undefined
    }
    try {
        // oxlint-disable-next-line compat/compat
        const { pathname, search } = new URL(url)
        return `${pathname}${search}`
    } catch {
        return undefined
    }
}
