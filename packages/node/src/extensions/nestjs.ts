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

export interface ExceptionCaptureOptions {
  /** Minimum HTTP status code to capture. Exceptions with a lower status (e.g. 4xx) are skipped. @default 500 */
  minStatusToCapture?: number
}

export interface PostHogInterceptorOptions {
  /** Enable exception capture. Pass `true` for defaults or an object to configure. @default false */
  captureExceptions?: boolean | ExceptionCaptureOptions
}

function getClientIp(headers: Record<string, any>, request: any): string | undefined {
  const forwarded = headers['x-forwarded-for']
  if (forwarded) {
    const ip = String(forwarded).split(',')[0].trim()
    if (ip) return ip
  }
  return request?.socket?.remoteAddress
}

function getExceptionStatus(exception: unknown): number | undefined {
  if (
    exception &&
    typeof exception === 'object' &&
    'getStatus' in exception &&
    typeof (exception as any).getStatus === 'function'
  ) {
    const status = (exception as any).getStatus()
    return typeof status === 'number' ? status : undefined
  }
  return undefined
}

export class PostHogInterceptor implements NestInterceptor {
  private posthog: PostHogBackendClient
  private captureExceptions: boolean
  private minStatusToCapture: number

  constructor(posthog: PostHogBackendClient, options?: PostHogInterceptorOptions) {
    this.posthog = posthog
    const capture = options?.captureExceptions
    this.captureExceptions = !!capture
    this.minStatusToCapture = (typeof capture === 'object' ? capture.minStatusToCapture : undefined) ?? 500
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const httpHost = context.switchToHttp()
    const request = httpHost.getRequest()
    const response = httpHost.getResponse()

    const headers = request?.headers ?? {}
    const sessionId: string | undefined = headers['x-posthog-session-id']
    const distinctId: string | undefined = headers['x-posthog-distinct-id']

    const contextData = {
      sessionId,
      distinctId,
      properties: {
        $current_url: request?.url,
        $request_method: request?.method,
        $request_path: request?.path ?? request?.url,
        $user_agent: headers['user-agent'],
        $ip: getClientIp(headers, request),
      },
    }

    const buildPipeline = () => {
      let source = next.handle()

      if (this.captureExceptions) {
        source = source.pipe(
          catchError((exception: unknown) => {
            if (ErrorTracking.isPreviouslyCapturedError(exception)) {
              return throwError(() => exception)
            }

            const status = getExceptionStatus(exception)
            if (status !== undefined && status < this.minStatusToCapture) {
              return throwError(() => exception)
            }

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
                $response_status_code: status ?? response?.statusCode,
                $ip: getClientIp(headers, request),
              }).then((msg) => {
                this.posthog.capture(msg)
              })
            )

            return throwError(() => exception)
          })
        )
      }

      return source
    }

    // Wrap in a new Observable so that subscription (and the entire handler
    // execution) runs inside withContext's AsyncLocalStorage.run() scope.
    // This ensures context is properly isolated per request and cleaned up
    // automatically, unlike enterContext which can leak across requests.
    return new Observable((subscriber) => {
      this.posthog.withContext(contextData, () => {
        buildPipeline().subscribe(subscriber)
      })
    })
  }
}
