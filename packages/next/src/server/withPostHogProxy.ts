import { isFunction } from '@posthog/core'
import type { NextFetchEvent, NextRequest } from 'next/server.js'
import { isNextControlFlowError } from '../shared/identity.js'
import { claimProxyError, settleProxyError } from './captureRequestError.js'
import type { NextRequestErrorContext, NextRequestErrorRequest, OnRequestErrorOptions } from './onRequestError.types.js'

/** A Next.js `proxy` (or `middleware`) function. */
export type NextProxyHandler<TResult> = (request: NextRequest, event: NextFetchEvent) => TResult

/** Sends a request error to PostHog and resolves to whether it reached posthog-node. */
type SendRequestError = (
    error: unknown,
    request: NextRequestErrorRequest,
    context: NextRequestErrorContext,
    options: OnRequestErrorOptions
) => Promise<boolean>

// How long a failing proxy waits for its exception to reach PostHog before Next.js handles the error. posthog-node
// can retry for much longer when PostHog is slow or unreachable; the capture carries on after this, kept alive
// with event.waitUntil where the platform supports it.
const PROXY_CAPTURE_TIMEOUT_MS = 2000

export function wrapProxy<TResult>(
    proxy: NextProxyHandler<TResult>,
    options: OnRequestErrorOptions,
    sendRequestError: SendRequestError
): NextProxyHandler<Promise<Awaited<TResult>>> {
    return async (request, event): Promise<Awaited<TResult>> => {
        try {
            return await proxy(request, event)
        } catch (error) {
            if (!isNextControlFlowError(error)) {
                await captureProxyError(error, request, event, options, sendRequestError)
            }
            throw error
        }
    }
}

async function captureProxyError(
    error: unknown,
    request: Request | undefined,
    event: NextFetchEvent | undefined,
    options: OnRequestErrorOptions,
    sendRequestError: SendRequestError
): Promise<void> {
    // Next.js 15 and earlier, and Next.js 16 for edge middleware.ts, also report the error to onRequestError once
    // it is rethrown. The claim makes onRequestError skip it, even while this capture is still running.
    if (!claimProxyError(error)) {
        return
    }
    const capture = sendRequestError(error, toRequestErrorRequest(request), getProxyErrorContext(event), options).then(
        (captured) => settleProxyError(error, captured),
        // Not expected, as sending reports its own failures; the proxy error must still reach Next.js.
        () => settleProxyError(error, false)
    )
    keepAlive(event, capture)
    await waitAtMost(capture, PROXY_CAPTURE_TIMEOUT_MS)
}

// Next.js labels middleware errors `middleware` before version 16 and `proxy` from 16 on. The wrapper cannot tell
// the version, so it names the file it wraps, from the event's source page (`/middleware`, `/src/proxy`, ...).
// That matches Next.js for proxy.ts, and for middleware.ts before 16.
function getProxyErrorContext(event: NextFetchEvent | undefined): NextRequestErrorContext {
    const routeType = event?.sourcePage?.endsWith('/middleware') ? 'middleware' : 'proxy'
    return { routerKind: 'Pages Router', routePath: `/${routeType}`, routeType }
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

function keepAlive(event: NextFetchEvent | undefined, promise: Promise<unknown>): void {
    if (!event || !isFunction(event.waitUntil)) {
        return
    }
    try {
        event.waitUntil(promise)
    } catch {
        // waitUntil can throw outside a request context.
    }
}

async function waitAtMost(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        // oxlint-disable-next-line compat/compat
        await Promise.race([
            promise,
            // oxlint-disable-next-line compat/compat
            new Promise<void>((resolve) => {
                timer = setTimeout(resolve, timeoutMs)
            }),
        ])
    } finally {
        clearTimeout(timer)
    }
}
