import { isFunction, safeSetTimeout } from '@posthog/core'
import type { NextFetchEvent, NextRequest } from 'next/server.js'
import { isPreviouslyCapturedError, markProxyCapturedError, parseAbsoluteUrl } from './captureRequestError.js'
import type { NextRequestErrorContext, NextRequestErrorRequest } from './onRequestError.types.js'

/** A Next.js `proxy` (or `middleware`) function. */
export type NextProxyHandler<TResult> = (request: NextRequest, event: NextFetchEvent) => TResult

/** Starts sending a request error to PostHog, or returns undefined when the wrapper does not capture errors. */
type StartCapture = (
    error: unknown,
    request: NextRequestErrorRequest,
    context: NextRequestErrorContext
) => Promise<unknown> | undefined

type WaitUntil = (promise: Promise<unknown>) => void

// The longest a serverless platform keeps the function running for a capture, as with Sentry's flush. The response
// never waits for the capture.
const KEEP_ALIVE_TIMEOUT_MS = 2000

// Vercel's request context, which Sentry reads too. Next.js 13 and 14 drop what was passed to event.waitUntil when the
// proxy throws, so the capture is also handed to Vercel directly.
const VERCEL_REQUEST_CONTEXT_KEY = Symbol.for('@vercel/request-context')

// The requests a wrapper has handled an error for, so that nested wrappers capture a request once. It is kept per
// request, not per error: one error object thrown by many requests (a cached failed init, say) is an occurrence in
// each, and a request the wrapper skips (an opted-out user, say) must not stop the next one from being captured.
const handledRequests = new WeakSet<object>()

export function wrapProxy<TResult>(
    proxy: NextProxyHandler<TResult>,
    startCapture: StartCapture
): NextProxyHandler<Promise<Awaited<TResult>>> {
    return async (request, event): Promise<Awaited<TResult>> => {
        try {
            return await proxy(request, event)
        } catch (error) {
            captureProxyError(error, request, event, startCapture)
            throw error
        }
    }
}

// Every error is captured, redirect() and notFound() too: Next.js handles those in a render, but in a proxy they are a
// 500 like any other error.
function captureProxyError(
    error: unknown,
    request: Request | undefined,
    event: NextFetchEvent | undefined,
    startCapture: StartCapture
): void {
    try {
        if (isPreviouslyCapturedError(error) || (request && handledRequests.has(request))) {
            return
        }
        const capture = startCapture(error, toRequestErrorRequest(request), getProxyErrorContext(event))
        if (!capture) {
            return
        }
        if (request) {
            handledRequests.add(request)
        }
        // Next.js 15 and earlier, and Next.js 16 for edge middleware.ts, also report the error to onRequestError once
        // it is rethrown. The mark makes onRequestError skip that report.
        markProxyCapturedError(error)
        keepAlive(
            capture.catch(() => undefined),
            event
        )
    } catch {
        // An error with a getter that throws, or a waitUntil that throws outside a request context: capturing must
        // never replace what the proxy threw.
    }
}

function keepAlive(capture: Promise<unknown>, event: NextFetchEvent | undefined): void {
    let timer: ReturnType<typeof setTimeout> | undefined
    // oxlint-disable-next-line compat/compat
    const timeout = new Promise<void>((resolve) => {
        timer = safeSetTimeout(resolve, KEEP_ALIVE_TIMEOUT_MS)
    })
    // oxlint-disable-next-line compat/compat
    const kept = Promise.race([capture, timeout]).finally(() => clearTimeout(timer))
    for (const waitUntil of [event?.waitUntil?.bind(event), getVercelWaitUntil()]) {
        waitUntil?.(kept)
    }
}

function getVercelWaitUntil(): WaitUntil | undefined {
    const store = globalThis as unknown as Record<symbol, { get?: () => { waitUntil?: WaitUntil } | undefined }>
    return store[VERCEL_REQUEST_CONTEXT_KEY]?.get?.()?.waitUntil
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

    const url = parseAbsoluteUrl(request?.url)
    return {
        headers,
        method: request?.method,
        path: url && `${url.pathname}${url.search}`,
        url: request?.url,
    }
}
