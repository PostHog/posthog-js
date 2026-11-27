import ErrorTracking from './error-tracking'
import { PostHogBackendClient } from '../client'
import { ErrorTracking as CoreErrorTracking } from '@posthog/core'
import {
  addProperty,
  getFirstHeaderValue,
  getPostHogCookieReadOptions,
  readPostHogTracingHeaders,
} from './tracing-headers'
import { normalizeRequestCurrentUrl, normalizeRequestPath } from './url-utils'
import type { Request, Response } from 'express'
import type { ContextData } from './context/types'
import { notifyContextListeners } from './context/listeners'

type ExpressMiddleware = (req: Request, res: Response, next: () => void) => void

type ExpressErrorMiddleware = (
  error: MiddlewareError,
  req: Request,
  res: Response,
  next: (error: MiddlewareError) => void
) => void

interface MiddlewareError extends Error {
  status?: number | string
  statusCode?: number | string
  status_code?: number | string
  output?: {
    statusCode?: number | string
  }
}

function getClientIp(req: Request): string | undefined {
  const forwarded = getFirstHeaderValue(req.headers['x-forwarded-for'])
  if (forwarded) {
    const ip = forwarded.split(',')[0].trim()
    if (ip) return ip
  }
  return req.socket?.remoteAddress
}

function buildRequestContextData(posthog: PostHogBackendClient, req: Request): Partial<ContextData> {
  const headers = readPostHogTracingHeaders(posthog.options, req.headers, getPostHogCookieReadOptions(posthog))
  const context = posthog.getContext()
  const sessionId = context?.sessionId ?? headers.sessionId
  const distinctId = context?.distinctId ?? headers.distinctId
  const properties: Record<string, any> = {}
  const disableCaptureUrlHashes = posthog.options.disableCaptureUrlHashes === true

  addProperty(
    properties,
    '$current_url',
    normalizeRequestCurrentUrl(req.originalUrl || req.url, disableCaptureUrlHashes)
  )
  addProperty(properties, '$request_method', req.method)
  addProperty(properties, '$request_path', normalizeRequestPath(req.path, disableCaptureUrlHashes))
  addProperty(properties, '$user_agent', getFirstHeaderValue(req.headers['user-agent']))
  addProperty(properties, '$ip', getClientIp(req))

  return {
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(distinctId !== undefined ? { distinctId } : {}),
    properties,
  }
}

/**
 * Register Express middleware that binds per-request PostHog context before your routes run.
 *
 * Reads `x-posthog-session-id` and `x-posthog-distinct-id` headers (or the `posthog-js` cookie when `readPostHogCookie` is enabled) and attaches `$current_url`, `$request_method`, `$request_path`, `$user_agent`, and `$ip` (first `x-forwarded-for` entry or `req.socket.remoteAddress`) to events in that request.
 *
 * Tracing headers are untrusted client data, never authentication, so pass an authenticated `distinctId` explicitly for authorization or sensitive decisions. Client IP geolocation from `$ip` also requires `disableGeoip: false`.
 *
 * @example
 * ```ts
 * import express from 'express'
 * import { PostHog, setupExpressErrorHandler, setupExpressRequestContext } from 'posthog-node'
 *
 * const app = express()
 * const client = new PostHog('<ph_project_api_key>', { host: 'https://us.i.posthog.com' })
 *
 * setupExpressRequestContext(client, app)
 * app.get('/', (_req, res) => {
 *   client.capture({ event: 'page_loaded' })
 *   res.send('ok')
 * })
 * setupExpressErrorHandler(client, app)
 * ```
 *
 * @param _posthog - PostHog client instance
 * @param app - Express app or router with `.use()`
 */
export function setupExpressRequestContext(
  _posthog: PostHogBackendClient,
  app: {
    use: (middleware: ExpressMiddleware) => unknown
  }
): void {
  app.use(posthogRequestContext(_posthog))
}

function posthogRequestContext(posthog: PostHogBackendClient): ExpressMiddleware {
  return (req, _res, next): void => {
    posthog.withContext(buildRequestContextData(posthog, req), () => {
      notifyContextListeners(posthog, true)
      next()
    })
  }
}

/**
 * Register Express error-handling middleware after your routes to capture unhandled exceptions.
 *
 * Attaches request context, `$response_status_code`, and `$session_id`, skips errors already captured by process autocapture, and forwards each error to `next(error)`.
 *
 * @param _posthog - PostHog client instance
 * @param app - Express app with `.use()`
 */
export function setupExpressErrorHandler(
  _posthog: PostHogBackendClient,
  app: {
    use: (middleware: ExpressMiddleware | ExpressErrorMiddleware) => unknown
  }
): void {
  app.use(posthogErrorHandler(_posthog))
}

function getResponseStatusCode(res: Response): Promise<number | undefined> {
  if (res.headersSent || res.destroyed) {
    return Promise.resolve(res.headersSent ? res.statusCode : undefined)
  }

  return new Promise((resolve) => {
    const complete = (statusCode: number | undefined): void => {
      clearTimeout(timeout)
      res.removeListener('finish', onComplete)
      res.removeListener('close', onComplete)
      resolve(statusCode)
    }
    const onComplete = (): void => complete(res.headersSent ? res.statusCode : undefined)
    // A downstream handler may never finish the response; do not hold the exception indefinitely.
    const timeout = setTimeout(() => complete(undefined), 1000)
    timeout.unref()
    res.once('finish', onComplete)
    res.once('close', onComplete)
  })
}

function posthogErrorHandler(posthog: PostHogBackendClient): ExpressErrorMiddleware {
  return (error: MiddlewareError, req, res, next: (error: MiddlewareError) => void): void => {
    if (ErrorTracking.isPreviouslyCapturedError(error)) {
      next(error)
      return
    }

    const contextData = buildRequestContextData(posthog, req)
    const syntheticException = new Error('Synthetic exception')
    const hint: CoreErrorTracking.EventHint = { mechanism: { type: 'middleware', handled: false }, syntheticException }
    const additionalProperties: Record<string, any> = {
      ...(contextData.sessionId !== undefined ? { $session_id: contextData.sessionId } : {}),
      ...(contextData.properties || {}),
    }

    posthog.addPendingPromise(
      Promise.all([
        ErrorTracking.buildEventMessage(
          posthog.getErrorPropertiesBuilder(),
          error,
          hint,
          contextData.distinctId,
          additionalProperties,
          undefined,
          posthog.getContext()
        ),
        // Downstream error handlers can choose a different status, even asynchronously.
        getResponseStatusCode(res),
      ]).then(([msg, statusCode]) => {
        if (statusCode !== undefined) {
          msg.properties = { ...msg.properties, $response_status_code: statusCode }
        }
        return posthog._capturePreparedEvent(msg, false)
      })
    )

    next(error)
  }
}
