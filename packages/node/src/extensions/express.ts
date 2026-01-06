import ErrorTracking from './error-tracking'
import { PostHogBackendClient } from '../client'
import { ErrorTracking as CoreErrorTracking } from '@posthog/core'
import type { Request, Response } from 'express'

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

    const sessionId: string | undefined = req.headers['x-posthog-session-id'] as string | undefined
    const distinctId: string | undefined = req.headers['x-posthog-distinct-id'] as string | undefined
    const syntheticException = new Error('Synthetic exception')
    const hint: CoreErrorTracking.EventHint = { mechanism: { type: 'middleware', handled: false }, syntheticException }

    posthog.addPendingPromise(
      ErrorTracking.buildEventMessage(error, hint, distinctId, {
        $session_id: sessionId,
        $current_url: req.url,
        $request_method: req.method,
        $request_path: req.path,
        $user_agent: req.headers['user-agent'],
        $response_status_code: res.statusCode,
        $ip: req.headers['x-forwarded-for'] || req?.socket?.remoteAddress,
      }).then((msg) => {
        posthog.capture(msg)
      })
    )

    next(error)
  }
}
