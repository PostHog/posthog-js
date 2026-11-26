import type { PostHogBackendClient } from '../client'
import { captureRequestException } from './request-exception'

/** The part of React Router's `handleError` arguments the handler reads, so `react-router` is not a dependency. */
export interface ReactRouterErrorArgs {
  request: Request
}

export interface ReactRouterErrorHandlerOptions<A extends ReactRouterErrorArgs = ReactRouterErrorArgs> {
  /**
   * Your own `handleError`, called for every error after the capture decision, captured or not. Exporting
   * `handleError` replaces React Router's own logging; without this option the handler logs the way React Router does
   * (`console.error`, skipping aborted requests).
   */
  handleError?: (error: unknown, args: A) => void
  /**
   * Return `false` to skip capturing an error the handler would otherwise capture. It receives the error to capture:
   * for a `data(error, init)` a middleware threw, the `error` inside.
   */
  shouldCapture?: (error: unknown, args: A) => boolean
}

/** React Router's `isRouteErrorResponse`: a thrown `data()`/`Response`, or a 404, 405 the router produced itself. */
function isRouteErrorResponse(error: unknown): error is { internal: boolean; error?: unknown } {
  if (error === null || typeof error !== 'object') {
    return false
  }
  const candidate = error as Record<string, unknown>
  return (
    typeof candidate.status === 'number' &&
    typeof candidate.statusText === 'string' &&
    typeof candidate.internal === 'boolean' &&
    'data' in candidate
  )
}

/**
 * The application error inside a route error response. A middleware that throws `data(error, init)` reaches
 * `handleError` as a route error response holding the error; the same throw from a loader arrives as the error itself.
 */
function getApplicationError(error: unknown): unknown {
  return isRouteErrorResponse(error) && !error.internal && error.error !== undefined ? error.error : error
}

// The other route error responses here are React Router's own 404 and 405. A thrown `Response`, `redirect()` or `data()`
// without an error never reaches `handleError`.
function isExpected(error: unknown, request: Request): boolean {
  return request.signal.aborted || isRouteErrorResponse(error)
}

/**
 * The page a request belongs to. A client navigation fetches `/page.data` (`/_root.data` for the index route, or
 * `/_.data` under a trailing slash with React Router 8), and `handleError` receives that request, not the page's.
 * Mirrors React Router's `getNormalizedPath`. Only the origin and path are reported.
 */
function getPageUrl(request: Request): string | undefined {
  try {
    const { origin, pathname: path } = new URL(request.url)
    const pagePath = path.endsWith('/_root.data')
      ? path.slice(0, -'/_root.data'.length) || '/'
      : path.endsWith('/_.data')
        ? path.slice(0, -'_.data'.length)
        : path.replace(/\.data$/, '')
    return pagePath === path ? undefined : `${origin}${pagePath}`
  } catch {
    return undefined
  }
}

function logLikeReactRouter(error: unknown, { request }: ReactRouterErrorArgs): void {
  if (request.signal.aborted) {
    return
  }
  // React Router logs the error inside its own error responses, such as "No route matches URL".
  console.error(isRouteErrorResponse(error) && error.error ? error.error : error)
}

/**
 * Returns a React Router `handleError` that captures server errors (loaders, actions, middleware, resource routes,
 * server rendering) with the request's person, session and request properties. It reports the page URL even for the
 * `.data` requests of client navigations, never the query string. It skips aborted requests and the 404 and 405
 * responses the router produces itself, and captures the error inside a `data(error, init)` a middleware threw. The
 * event is marked unhandled, with the `middleware` mechanism and `$exception_source: 'react_router.handle_error'`.
 *
 * IDs set with `withContext` (in a middleware, for example) win. Otherwise, linking page loads to the browser's person
 * and session reads the posthog-js cookie, which needs the client's `readPostHogCookie: true`, and requests with
 * `x-posthog-*` tracing headers link without it. An anonymous visitor's exceptions carry their anonymous distinct ID and
 * stay personless. When the visitor's consent cookie opts out, the event keeps no person, session, device, user agent
 * or IP.
 *
 * Errors raised while streaming, after the shell was sent, skip `handleError` and reach the `onError` of the React
 * stream in `entry.server.tsx`; call the same handler there. An error object is captured once per request, however
 * many hooks or handlers see it.
 *
 * The returned handler resolves once the event is queued. On a serverless host, pass the platform's `waitUntil` as the
 * client's `waitUntil` option. On Cloudflare Workers, create the client and the handler per request, with the request's
 * `ctx.waitUntil`: a client kept across requests in a Workers isolate delivers only the first request's events.
 *
 * @experimental Subject to change in a minor release.
 *
 * @example
 * ```ts
 * // app/entry.server.tsx
 * const posthog = new PostHog('<ph_project_token>', { host: '<ph_client_api_host>', readPostHogCookie: true })
 *
 * export const handleError = createReactRouterErrorHandler(posthog)
 *
 * // In handleRequest, in the renderToPipeableStream options:
 * onError(error: unknown) {
 *   responseStatusCode = 500
 *   if (shellRendered && !request.signal.aborted) {
 *     void handleError(error, { request })
 *   }
 * },
 * ```
 */
export function createReactRouterErrorHandler<A extends ReactRouterErrorArgs = ReactRouterErrorArgs>(
  posthog: PostHogBackendClient,
  options: ReactRouterErrorHandlerOptions<A> = {}
): (error: unknown, args: A) => Promise<void> {
  return (error, args) => {
    let captured: Promise<void> = Promise.resolve()
    try {
      const applicationError = getApplicationError(error)
      if (!isExpected(applicationError, args.request) && options.shouldCapture?.(applicationError, args) !== false) {
        captured = captureRequestException(posthog, applicationError, args.request, {
          url: getPageUrl(args.request),
          source: 'react_router.handle_error',
        })
      }
    } catch {
      // Capturing must never break the app's error handling.
    }
    ;(options.handleError ?? logLikeReactRouter)(error, args)
    return captured
  }
}
