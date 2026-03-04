import ErrorTracking from './error-tracking'
import { PostHogBackendClient } from '../client'
import { ErrorTracking as CoreErrorTracking } from '@posthog/core'

// Local interfaces to avoid runtime dependency on @nestjs/common
interface HttpArgumentsHost {
  getRequest<T = any>(): T
  getResponse<T = any>(): T
}

interface ArgumentsHost {
  switchToHttp(): HttpArgumentsHost
}

interface ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void
}

export class PostHogExceptionFilter implements ExceptionFilter {
  private posthog: PostHogBackendClient

  constructor(posthog: PostHogBackendClient) {
    this.posthog = posthog
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    if (ErrorTracking.isPreviouslyCapturedError(exception)) {
      throw exception
    }

    const httpHost = host.switchToHttp()
    const request = httpHost.getRequest()
    const response = httpHost.getResponse()

    const headers = request?.headers ?? {}
    const sessionId: string | undefined = headers['x-posthog-session-id']
    const distinctId: string | undefined = headers['x-posthog-distinct-id']
    const syntheticException = new Error('Synthetic exception')
    const hint: CoreErrorTracking.EventHint = { mechanism: { type: 'middleware', handled: false }, syntheticException }

    this.posthog.addPendingPromise(
      ErrorTracking.buildEventMessage(exception, hint, distinctId, {
        $session_id: sessionId,
        $current_url: request?.url,
        $request_method: request?.method,
        $request_path: request?.path ?? request?.url,
        $user_agent: headers['user-agent'],
        $response_status_code: response?.statusCode,
        $ip: headers['x-forwarded-for'] || request?.socket?.remoteAddress,
      }).then((msg) => {
        this.posthog.capture(msg)
      })
    )

    throw exception
  }
}
