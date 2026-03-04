import { Observable, throwError } from 'rxjs'
import { catchError } from 'rxjs/operators'

import ErrorTracking from './error-tracking'
import { PostHogBackendClient } from '../client'
import { ErrorTracking as CoreErrorTracking } from '@posthog/core'

// Local interfaces to avoid runtime dependency on @nestjs/common
interface HttpArgumentsHost {
  getRequest<T = any>(): T
  getResponse<T = any>(): T
}

interface ExecutionContext {
  switchToHttp(): HttpArgumentsHost
}

interface CallHandler<T = any> {
  handle(): Observable<T>
}

interface NestInterceptor<T = any, R = any> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<R>
}

export interface PostHogInterceptorOptions {
  captureExceptions?: boolean
}

export class PostHogInterceptor implements NestInterceptor {
  private posthog: PostHogBackendClient
  private captureExceptions: boolean

  constructor(posthog: PostHogBackendClient, options?: PostHogInterceptorOptions) {
    this.posthog = posthog
    this.captureExceptions = options?.captureExceptions ?? true
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const httpHost = context.switchToHttp()
    const request = httpHost.getRequest()
    const response = httpHost.getResponse()

    const headers = request?.headers ?? {}
    const sessionId: string | undefined = headers['x-posthog-session-id']
    const distinctId: string | undefined = headers['x-posthog-distinct-id']

    this.posthog.enterContext({
      sessionId,
      distinctId,
      properties: {
        $current_url: request?.url,
        $request_method: request?.method,
        $request_path: request?.path ?? request?.url,
        $user_agent: headers['user-agent'],
        $ip: headers['x-forwarded-for'] || request?.socket?.remoteAddress,
      },
    })

    if (!this.captureExceptions) {
      return next.handle()
    }

    return next.handle().pipe(
      catchError((exception: unknown) => {
        if (!ErrorTracking.isPreviouslyCapturedError(exception)) {
          const syntheticException = new Error('Synthetic exception')
          const hint: CoreErrorTracking.EventHint = {
            mechanism: { type: 'middleware', handled: false },
            syntheticException,
          }

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
        }

        return throwError(() => exception)
      })
    )
  }
}
