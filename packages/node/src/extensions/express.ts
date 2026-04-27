import ErrorTracking from './error-tracking'
import { PostHogBackendClient } from '../client'
import { ErrorTracking as CoreErrorTracking } from '@posthog/core'
import { getPostHogTracingHeaderValues } from './tracing-headers'
import type { Request, Response } from 'express'
import type { ContextData } from './context/types'

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

function addProperty(properties: Record<string, any>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') {
    properties[key] = value
  }
}

function getFirstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function getClientIp(req: Request): string | undefined {
  const forwarded = getFirstHeaderValue(req.headers['x-forwarded-for'])
  if (forwarded) {
    const ip = forwarded.split(',')[0].trim()
    if (ip) return ip
  }
  return req.socket?.remoteAddress
}

function buildRequestContextData(req: Request): Partial<ContextData> {
  const { sessionId, windowId, distinctId } = getPostHogTracingHeaderValues(req.headers)
  const properties: Record<string, any> = {}

  addProperty(properties, '$current_url', req.originalUrl || req.url)
  addProperty(properties, '$request_method', req.method)
  addProperty(properties, '$request_path', req.path)
  addProperty(properties, '$user_agent', getFirstHeaderValue(req.headers['user-agent']))
  addProperty(properties, '$ip', getClientIp(req))
  addProperty(properties, '$window_id', windowId)

  return {
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(distinctId !== undefined ? { distinctId } : {}),
    properties,
  }
}

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
    posthog.withContext(buildRequestContextData(req), () => next())
  }
}

export function setupExpressErrorHandler(
  _posthog: PostHogBackendClient,
  app: {
    use: (middleware: ExpressMiddleware | ExpressErrorMiddleware) => unknown
  }
): void {
  app.use(posthogErrorHandler(_posthog))
}

function posthogErrorHandler(posthog: PostHogBackendClient): ExpressErrorMiddleware {
  return (error: MiddlewareError, req, res, next: (error: MiddlewareError) => void): void => {
    if (ErrorTracking.isPreviouslyCapturedError(error)) {
      next(error)
      return
    }

    const contextData = buildRequestContextData(req)
    const syntheticException = new Error('Synthetic exception')
    const hint: CoreErrorTracking.EventHint = { mechanism: { type: 'middleware', handled: false }, syntheticException }
    const additionalProperties: Record<string, any> = {
      ...(contextData.sessionId !== undefined ? { $session_id: contextData.sessionId } : {}),
      ...(contextData.properties || {}),
      $response_status_code: res.statusCode,
    }

    posthog.addPendingPromise(
      ErrorTracking.buildEventMessage(error, hint, contextData.distinctId, additionalProperties).then((msg) => {
        posthog.capture(msg)
      })
    )

    next(error)
  }
}
