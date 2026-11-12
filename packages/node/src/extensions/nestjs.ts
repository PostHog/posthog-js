import type { IncomingHttpHeaders } from 'node:http'
import { Observable, throwError } from 'rxjs'
import { catchError } from 'rxjs/operators'

import ErrorTracking from './error-tracking'
import {
  addProperty,
  getFirstHeaderValue,
  getPostHogCookieReadOptions,
  readPostHogTracingHeaders,
} from './tracing-headers'
import { normalizeRequestCurrentUrl, normalizeRequestPath } from './url-utils'
import { notifyContextListeners } from './context/listeners'
import { getContextLifetimeSignal } from './context/lifetime'
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
      // Blank IDs fall back; any other ID is kept verbatim, as explicit captures keep it.
      return typeof distinctId === 'string' && distinctId.trim() ? distinctId : undefined
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
    const { sessionId, distinctId } = readPostHogTracingHeaders(
      this.posthog.options,
      headers,
      getPostHogCookieReadOptions(this.posthog)
    )

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
      // Identity is read when the request subscribes, so it comes from this request's async context.
      // The order is: the app's getDistinctId, then the tracing headers, then identity the app set
      // before this interceptor ran, for example in a middleware. Headers come before that earlier
      // identity, so a context the app entered globally can't override a request's own header.
      const existing = this.posthog.getContext()
      const resolvedDistinctId = this.resolveDistinctId(request)
      const requestDistinctId = resolvedDistinctId ?? distinctId ?? existing?.distinctId
      const requestSessionId = sessionId ?? existing?.sessionId

      // The app can give withContext an AbortSignal to end that context early, for example when the
      // request it belongs to is cancelled. After the signal aborts, getContext() no longer returns
      // the context. The fresh context below would not see that signal, so identity copied from the
      // earlier context would stay visible to the handler after the app ended it. Passing the earlier
      // context's signal on makes the copied identity end at the same time as the original.
      const copiesDistinctId =
        resolvedDistinctId === undefined && distinctId === undefined && existing?.distinctId !== undefined
      const copiesSessionId = sessionId === undefined && existing?.sessionId !== undefined
      const signal = existing && (copiesDistinctId || copiesSessionId) ? getContextLifetimeSignal(existing) : undefined

      // Properties always start fresh, so properties from an earlier context never reach this request.
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
                const properties: Record<string, any> | undefined =
                  responseStatus !== undefined ? { $response_status_code: responseStatus } : undefined
                // A copied distinct ID that the app already ended must not label this exception.
                const exceptionDistinctId = copiesDistinctId && signal?.aborted ? undefined : requestDistinctId
                this.posthog.captureException(exception, { distinctId: exceptionDistinctId, properties })
                return throwError(() => exception)
              })
            )
          }

          return source.subscribe(subscriber)
        },
        { fresh: true, ...(signal ? { signal } : {}) }
      )
    })
  }
}
