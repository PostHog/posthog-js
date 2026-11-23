import type { PostHogBackendClient } from '../client'
import { captureRequestException } from './request-exception'

/** The part of React Router's `handleError` arguments the handler reads, so `react-router` is not a dependency. */
export interface ReactRouterErrorArgs {
  request: Request
}

export interface ReactRouterErrorHandlerOptions {
  /**
   * Runs after the capture decision for every error, captured or not, with the same arguments. Exporting
   * `handleError` replaces React Router's own logging; without this option the handler logs the way React Router
   * does (`console.error`, skipping aborted requests).
   */
  onError?: (error: unknown, args: ReactRouterErrorArgs) => void
}

/** React Router's `isRouteErrorResponse`: a thrown `data()`/`Response`, or a 404, 405 the router produced itself. */
function isRouteErrorResponse(error: unknown): error is { error?: unknown } {
  if (error === null || typeof error !== 'object') {
    return false
  }
  const candidate = error as Record<string, unknown>
  return (
    typeof candidate.status === 'number' &&
    typeof candidate.statusText === 'string' &&
    typeof candidate.internal === 'boolean' &&
    'data' in candidate
  )
}

function isExpected(error: unknown, request: Request): boolean {
  return (
    request.signal.aborted ||
    isRouteErrorResponse(error) ||
    (typeof Response !== 'undefined' && error instanceof Response)
  )
}

function logLikeReactRouter(error: unknown, { request }: ReactRouterErrorArgs): void {
  if (request.signal.aborted) {
    return
  }
  // React Router logs the error inside its own error responses, such as "No route matches URL".
  console.error(isRouteErrorResponse(error) && error.error ? error.error : error)
}

/**
 * Returns a React Router `handleError` that captures server errors (loaders, actions, middleware, resource routes,
 * server rendering) with the request's person, session and request properties. It skips aborted requests, thrown
 * responses (`data()`, `redirect()`) and the 404/405 responses the router produces itself. Reading the posthog-js
 * cookie, so page loads link to the browser session, needs the client's `readPostHogCookie` option.
 *
 * Call it from the `onError` of the React stream in `entry.server.tsx` too, for errors raised after the shell was
 * sent: React Router does not pass those to `handleError`. An error is captured once even when both call it.
 *
 * @example
 * ```ts
 * // app/entry.server.tsx
 * export const handleError = createReactRouterErrorHandler(posthog)
 * ```
 */
export function createReactRouterErrorHandler(
  posthog: Parameters<typeof captureRequestException>[0] & Pick<PostHogBackendClient, 'getContext'>,
  options: ReactRouterErrorHandlerOptions = {}
): (error: unknown, args: ReactRouterErrorArgs) => void {
  const captured = new WeakSet<object>()
  return (error, args) => {
    try {
      const seen = typeof error === 'object' && error !== null && captured.has(error)
      if (!seen && !isExpected(error, args.request)) {
        if (typeof error === 'object' && error !== null) {
          captured.add(error)
        }
        captureRequestException(posthog, error, args.request)
      }
    } catch {
      // Capturing must never break the app's error handling.
    }
    ;(options.onError ?? logLikeReactRouter)(error, args)
  }
}
