import type { IncomingHttpHeaders } from 'node:http'
import { Observable, throwError } from 'rxjs'
import { catchError } from 'rxjs/operators'

import ErrorTracking from './error-tracking'
import {
  addProperty,
  getFirstHeaderValue,
  getPostHogCookieReadOptions,
  getPostHogTracingHeaderValues,
} from './tracing-headers'
import { normalizeRequestCurrentUrl, normalizeRequestPath } from './url-utils'
import { notifyContextListeners } from './context/listeners'
import { PostHogBackendClient } from '../client'

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
  /**
   * Returns the distinct ID for a request, such as the signed-in user's ID from your auth layer.
   * It takes precedence over the `X-POSTHOG-DISTINCT-ID` tracing header and over a distinct ID
   * already set in the PostHog context. Return `undefined` to fall back to those.
   */
  getDistinctId?: (request: any) => string | undefined
}

function getClientIp(headers: IncomingHttpHeaders, request: any): string | undefined {
  const forwarded = getFirstHeaderValue(headers['x-forwarded-for'])
  if (forwarded) {
    const ip = forwarded.split(',')[0].trim()
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
  private getDistinctId?: (request: any) => string | undefined

  constructor(posthog: PostHogBackendClient, options?: PostHogInterceptorOptions) {
    this.posthog = posthog
    const capture = options?.captureExceptions
    this.captureExceptions = !!capture
    this.minStatusToCapture = (typeof capture === 'object' ? capture.minStatusToCapture : undefined) ?? 500
    this.getDistinctId = options?.getDistinctId
  }

  private resolveDistinctId(request: any): string | undefined {
    if (!this.getDistinctId) {
      return undefined
    }
    try {
      const distinctId = this.getDistinctId(request)
      return typeof distinctId === 'string' && distinctId.trim() ? distinctId.trim() : undefined
    } catch {
      // A failing resolver must not break the request; fall back to headers and context.
      return undefined
    }
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const httpHost = context.switchToHttp()
    const request = httpHost.getRequest()
    const response = httpHost.getResponse()

    const headers = (request?.headers ?? {}) as IncomingHttpHeaders
    const { sessionId, distinctId } = getPostHogTracingHeaderValues(headers, getPostHogCookieReadOptions(this.posthog))

    const properties: Record<string, any> = {}
    const disableCaptureUrlHashes = this.posthog.options.disable_capture_url_hashes === true
    addProperty(properties, '$current_url', normalizeRequestCurrentUrl(request?.url, disableCaptureUrlHashes))
    addProperty(properties, '$request_method', request?.method)
    addProperty(
      properties,
      '$request_path',
      normalizeRequestPath(request?.path ?? request?.url, disableCaptureUrlHashes)
    )
    addProperty(properties, '$user_agent', getFirstHeaderValue(headers['user-agent']))
    addProperty(properties, '$ip', getClientIp(headers, request))

    return new Observable((subscriber) => {
      // Read identity at subscription time, inside this request's async context. The resolver is
      // the application's own identity and wins. Tracing headers come next, so a stray ambient
      // context can't override them. Identity the application set before the interceptor, such as
      // in a middleware, fills in when there is no header. Properties always start fresh.
      const existing = this.posthog.getContext()
      const requestDistinctId = this.resolveDistinctId(request) ?? distinctId ?? existing?.distinctId
      const requestSessionId = sessionId ?? existing?.sessionId
      const contextData = {
        ...(requestSessionId !== undefined ? { sessionId: requestSessionId } : {}),
        ...(requestDistinctId !== undefined ? { distinctId: requestDistinctId } : {}),
        properties,
      }

      return this.posthog.withContext(
        contextData,
        () => {
          notifyContextListeners(this.posthog, true)
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
                const responseStatus = status ?? response?.statusCode
                const additionalProperties: Record<string, any> | undefined =
                  responseStatus !== undefined ? { $response_status_code: responseStatus } : undefined
                this.posthog.captureException(exception, requestDistinctId, additionalProperties)
                return throwError(() => exception)
              })
            )
          }

          return source.subscribe(subscriber)
        },
        { fresh: true }
      )
    })
  }
}
