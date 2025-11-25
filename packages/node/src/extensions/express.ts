import type * as http from 'node:http'
import { uuidv7 } from '@posthog/core'
import ErrorTracking from './error-tracking'
import { PostHogBackendClient } from '../client'
import { ErrorTracking as CoreErrorTracking } from '@posthog/core'

type ExpressMiddleware = (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void

type ExpressErrorMiddleware = (
  error: MiddlewareError,
  req: http.IncomingMessage,
  res: http.ServerResponse,
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
    const sessionId: string | undefined = req.headers['x-posthog-session-id'] as string | undefined
    const distinctId: string | undefined = req.headers['x-posthog-distinct-id'] as string | undefined
    const syntheticException = new Error('Synthetic exception')
    const hint: CoreErrorTracking.EventHint = { mechanism: { type: 'middleware', handled: false }, syntheticException }
    posthog.addPendingPromise(
      ErrorTracking.buildEventMessage(error, hint, distinctId ?? uuidv7(), {
        $process_person_profile: distinctId != undefined,
        $session_id: sessionId,
        $current_url: req.url,
        method: req.method,
        status_code: res.statusCode,
      }).then((msg) => posthog.capture(msg))
    )
    next(error)
  }
}
