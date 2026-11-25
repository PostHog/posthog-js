import type { HandleErrorFunction } from 'react-router'
import { createReactRouterErrorHandler, PostHog } from '../../entrypoints/index.node'

const posthog = new PostHog('phc_test')

// The handler is React Router's `handleError`.
export const handleError: HandleErrorFunction = createReactRouterErrorHandler(posthog)

// An existing `handleError` that reads every argument composes under `strict`.
const existing: HandleErrorFunction = (error, { request, params, context }) => {
  console.error(error, request.url, params, context)
}
export const wrapped: HandleErrorFunction = createReactRouterErrorHandler(posthog, {
  handleError: existing,
  shouldCapture: (_error, { params }) => params.sku !== 'test',
})

// The stream `onError` in entry.server.tsx has only the request.
export function onStreamError(error: unknown, request: Request): Promise<void> {
  return createReactRouterErrorHandler(posthog)(error, { request })
}
