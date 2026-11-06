import type { PostHogBackendClient } from '../client'
import type { ContextData } from './context/types'
import { notifyContextListeners } from './context/listeners'
import { addProperty, getPostHogCookieReadOptions, getPostHogTracingHeaderValues } from './tracing-headers'
import { normalizeRequestPath } from './url-utils'

/** Duration histogram, in seconds, using the OpenTelemetry HTTP semantic convention name. */
export const HTTP_SERVER_REQUEST_DURATION_METRIC = 'http.server.request.duration'
/** Counter of requests served. */
export const HTTP_SERVER_REQUEST_COUNT_METRIC = 'http.server.request.count'

// Seconds, the boundaries the OpenTelemetry HTTP semantic conventions recommend for this histogram.
const DURATION_BOUNDS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10]

export interface InstrumentRequestOptions {
  /**
   * The matched route pattern (`/users/:id`), once the handler has run. Used to name the span
   * and as the `http.route` metric attribute. Without it the span is named after the method only,
   * so raw paths never become high-cardinality span names or metric series.
   */
  getRoute?: (request: Request, response: Response | undefined) => string | undefined
  /** Skip instrumentation (health checks, for example). The handler still runs, with no span or metrics. */
  ignore?: (request: Request) => boolean
}

type PostHogForRequests = Pick<
  PostHogBackendClient,
  'withContext' | 'withSpan' | 'getContext' | 'metrics' | 'apiKey' | 'options'
>

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {}
  headers.forEach((value, key) => {
    record[key.toLowerCase()] = value
  })
  return record
}

function safePathname(request: Request): string | undefined {
  try {
    return new URL(request.url).pathname
  } catch {
    return undefined
  }
}

/**
 * Instruments one request on the fetch API (`Request` in, `Response` out): Hono, Bun, Deno, Next route
 * handlers, Cloudflare Workers, and anything else that works that way.
 *
 * - reads `x-posthog-session-id` / `x-posthog-distinct-id` (or the posthog-js cookie when `readPostHogCookie` is on)
 *   and runs the handler inside `withContext`, so events and spans carry the person and the replay
 * - opens a `server` span continuing an inbound `traceparent`, named `METHOD route` once the route is known
 * - marks 5xx responses and thrown errors as span errors (the error is rethrown)
 * - records `http.server.request.duration` (seconds histogram) and `http.server.request.count`,
 *   by method, route and status code
 *
 * @experimental Subject to change in a minor release.
 *
 * @example
 * ```ts
 * export default {
 *   fetch: (request: Request) => instrumentRequest(posthog, request, () => app.fetch(request)),
 * }
 * ```
 */
export async function instrumentRequest(
  posthog: PostHogForRequests,
  request: Request,
  handler: () => Response | Promise<Response>,
  options: InstrumentRequestOptions = {}
): Promise<Response> {
  if (options.ignore?.(request)) {
    return handler()
  }

  const headers = getPostHogTracingHeaderValues(headersToRecord(request.headers), getPostHogCookieReadOptions(posthog))
  const existing = posthog.getContext()
  const disableCaptureUrlHashes = posthog.options.disable_capture_url_hashes === true
  const pathname = safePathname(request)
  const properties: Record<string, any> = {}
  addProperty(properties, '$request_method', request.method)
  addProperty(
    properties,
    '$request_path',
    pathname ? normalizeRequestPath(pathname, disableCaptureUrlHashes) : undefined
  )
  addProperty(properties, '$user_agent', request.headers.get('user-agent') ?? undefined)

  const sessionId = existing?.sessionId ?? headers.sessionId
  const distinctId = existing?.distinctId ?? headers.distinctId
  const contextData: Partial<ContextData> = {
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(distinctId !== undefined ? { distinctId } : {}),
    properties,
  }

  const method = request.method.toUpperCase()
  const startedAt = performance.now()

  return posthog.withContext(contextData, () => {
    notifyContextListeners(posthog as unknown as PostHogBackendClient, true)
    return posthog.withSpan(
      method,
      {
        kind: 'server',
        parent: request.headers.get('traceparent') ?? undefined,
        attributes: { 'http.request.method': method, ...(pathname ? { 'url.path': pathname } : {}) },
      },
      async (span) => {
        let response: Response | undefined
        let thrown: unknown
        let failed = false
        try {
          response = await handler()
        } catch (error) {
          failed = true
          thrown = error
        }

        let route: string | undefined
        try {
          route = options.getRoute?.(request, response)
        } catch {
          // A broken route resolver must not break the request.
        }
        const statusCode = failed ? 500 : (response?.status ?? 500)
        if (route) {
          span.updateName(`${method} ${route}`)
          span.setAttribute('http.route', route)
        }
        span.setAttribute('http.response.status_code', statusCode)
        if (failed) {
          span.recordException(thrown)
        } else if (statusCode >= 500) {
          span.setStatus('error')
        }

        const attributes: Record<string, string | number> = {
          'http.request.method': method,
          'http.response.status_code': statusCode,
          ...(route ? { 'http.route': route } : {}),
        }
        posthog.metrics.histogram(HTTP_SERVER_REQUEST_DURATION_METRIC, (performance.now() - startedAt) / 1000, {
          unit: 's',
          attributes,
          bounds: DURATION_BOUNDS_SECONDS,
        })
        posthog.metrics.count(HTTP_SERVER_REQUEST_COUNT_METRIC, 1, { attributes })

        if (failed) {
          throw thrown
        }
        return response as Response
      }
    )
  })
}

/** The slice of a Hono `Context` the middleware uses, so `hono` is not a dependency. */
interface HonoContextLike {
  req: { raw: Request; routePath: string }
  res: Response
}

/**
 * Hono middleware that instruments every request. See {@link instrumentRequest}. The span is named after
 * the matched route (`GET /api/users/:id`), and a thrown error is recorded as a 500.
 *
 * @experimental Subject to change in a minor release.
 *
 * @example
 * ```ts
 * app.use('*', posthogHonoMiddleware(posthog))
 * ```
 */
export function posthogHonoMiddleware(
  posthog: PostHogForRequests,
  options: Omit<InstrumentRequestOptions, 'getRoute'> = {}
): (c: HonoContextLike, next: () => Promise<void>) => Promise<void> {
  return async (c, next) => {
    // Hono's `next()` resolves with the response on `c.res` (error handlers set it too), so wrap that.
    await instrumentRequest(
      posthog,
      c.req.raw,
      async () => {
        await next()
        return c.res
      },
      {
        ...options,
        // routePath is the last matched route; the catch-all `/*` means nothing matched.
        getRoute: () => (c.req.routePath && c.req.routePath !== '/*' ? c.req.routePath : undefined),
      }
    )
  }
}
