import { PostHog } from 'posthog-node'
import { serverClient } from './server-client'
import { uuidv7 } from '@posthog/core/vendor/uuidv7'
import type { PostHogCommon, PostHogServerConfig } from '../module'
import type { JsonType } from '@posthog/core'

type RequestContext = {
  path?: string
  method?: string
  source?: object
  headers?: Headers | Record<string, string | string[] | undefined>
}
type RequestIdentity = { distinctId?: string; sessionId?: string }
type RequestWrapper = <T>(request: RequestContext, handler: () => T | Promise<T>) => Promise<T>
type ErrorHandler = (error: unknown, request?: RequestContext) => Promise<void>
type NitroBindings = {
  useRuntimeConfig: () => unknown
  onError: (handler: ErrorHandler) => void
  onClose: (handler: () => Promise<void>) => void
  wrapRequest?: (wrapper: RequestWrapper) => void
}
type RuntimeConfig = {
  public: { posthog: PostHogCommon }
  posthogServerConfig: PostHogServerConfig
}

function readHeader(headers: RequestContext['headers'], name: string): string | undefined {
  const value = headers instanceof Headers ? headers.get(name) : headers?.[name]
  if (Array.isArray(value)) {
    return value.map((item) => readHeader({ [name]: item }, name)).find((item) => item !== undefined)
  }
  if (typeof value !== 'string') return undefined
  // oxlint-disable-next-line no-control-regex
  const sanitized = value.replace(/[\x00-\x1F\x7F-\x9F]/g, '')
  return sanitized.trim().slice(0, 1000) || undefined
}

export function setupPostHogNitroPlugin({ useRuntimeConfig, onError, onClose, wrapRequest }: NitroBindings): void {
  const runtimeConfig = useRuntimeConfig() as RuntimeConfig
  const posthogCommon = runtimeConfig.public.posthog
  const { requestContext, ...posthogServerConfig } = runtimeConfig.posthogServerConfig
  const debug = posthogCommon.debug === true

  const client = new PostHog(posthogCommon.publicKey, {
    host: posthogCommon.host,
    ...posthogServerConfig,
  })

  serverClient.current = client
  const requestContexts = new WeakMap<object, RequestIdentity>()

  if (requestContext) {
    const spanContext = import('posthog-node/otel').catch(() => undefined)
    wrapRequest?.(async (request, handler) => {
      const existing = client.getContext()
      const identity = {
        distinctId: existing?.distinctId ?? readHeader(request.headers, 'x-posthog-distinct-id'),
        sessionId: existing?.sessionId ?? readHeader(request.headers, 'x-posthog-session-id'),
      }
      if (request.source) requestContexts.set(request.source, identity)
      const lifetime = new AbortController()
      return client.withContext(
        identity,
        async () => {
          try {
            const tracing = await spanContext
            tracing?.enrichCurrentSpan?.(client)
            return await handler()
          } finally {
            lifetime.abort()
          }
        },
        { fresh: true, signal: lifetime.signal }
      )
    })
  }

  if (debug) {
    client.debug(true)
  }

  if (posthogServerConfig.enableExceptionAutocapture) {
    onError((error, request) => {
      const props: JsonType = {
        $process_person_profile: false,
      }
      if (request?.path) {
        try {
          // Prefix origin-form targets to preserve leading double slashes as part of the path.
          const target = request.path.startsWith('/') ? `http://localhost${request.path}` : request.path
          const url = new URL(target, 'http://localhost')
          props.path = url.pathname + (posthogServerConfig.disable_capture_url_hashes === true ? '' : url.hash)
        } catch {
          // A malformed request URL must not prevent capturing the original exception.
        }
      }
      if (request?.method) {
        props.method = request.method
      }

      const identity = request?.source ? requestContexts.get(request.source) : undefined
      if (identity?.sessionId) props.$session_id = identity.sessionId
      client.withContext(
        identity ?? {},
        () => {
          client.captureException(error, identity?.distinctId ?? uuidv7(), props)
        },
        { fresh: true }
      )
      return client.flush().catch(() => {})
    })
  }

  onClose(async () => {
    await client.shutdown()
    if (serverClient.current === client) serverClient.current = undefined
  })
}
