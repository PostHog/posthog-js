import type { IncomingHttpHeaders } from 'node:http'
import { PostHog } from '@/entrypoints/index.node'
import { setupExpressErrorHandler, setupExpressRequestContext } from '@/extensions/express'

jest.mock('../../version', () => ({ version: '1.2.3' }))

const mockedFetch = jest.spyOn(globalThis, 'fetch').mockImplementation()

const waitForFlushTimer = async (posthog: PostHog): Promise<void> => {
  await posthog.shutdown()
}

const getLastBatchEvents = (): any[] | undefined => {
  expect(mockedFetch).toHaveBeenCalledWith('http://example.com/batch/', expect.objectContaining({ method: 'POST' }))

  const call = [...mockedFetch.mock.calls].reverse().find((x) => (x[0] as string).includes('/batch/'))
  if (!call) {
    return undefined
  }
  return JSON.parse((call[1] as any).body as any).batch
}

const createMockRequest = (overrides?: {
  headers?: IncomingHttpHeaders
  originalUrl?: string
  url?: string
  method?: string
  path?: string
  remoteAddress?: string
}): any => ({
  originalUrl: overrides?.originalUrl,
  url: overrides?.url ?? '/test-path',
  method: overrides?.method ?? 'GET',
  path: overrides?.path ?? '/test-path',
  headers: overrides?.headers ?? {},
  socket: { remoteAddress: overrides?.remoteAddress ?? '127.0.0.1' },
})

const createMockResponse = (overrides?: { statusCode?: number }): any => ({
  statusCode: overrides?.statusCode ?? 500,
})

const createRequestContextMiddleware = (posthog: PostHog): any => {
  const app = { use: jest.fn() }
  setupExpressRequestContext(posthog, app)
  return app.use.mock.calls[0][0]
}

const createErrorHandlerMiddleware = (posthog: PostHog): any => {
  const app = { use: jest.fn() }
  setupExpressErrorHandler(posthog, app)
  return app.use.mock.calls[0][0]
}

describe('Express extension', () => {
  let posthog: PostHog

  beforeEach(() => {
    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      fetchRetryCount: 0,
      disableCompression: true,
      flushAt: 1,
      flushInterval: 0,
    })

    mockedFetch.mockResolvedValue({
      status: 200,
      text: () => Promise.resolve('ok'),
      json: () => Promise.resolve({ status: 'ok' }),
    } as any)
  })

  afterEach(async () => {
    await posthog.shutdown()
  })

  describe('request context middleware', () => {
    it('should register middleware with setupExpressRequestContext', () => {
      const app = { use: jest.fn() }

      setupExpressRequestContext(posthog, app)

      expect(app.use).toHaveBeenCalledWith(expect.any(Function))
    })

    it('should set request context for normal captures', async () => {
      const middleware = createRequestContextMiddleware(posthog)
      const req = createMockRequest({
        headers: {
          'x-posthog-session-id': 'session-123',
          'x-posthog-distinct-id': 'user-456',
          'user-agent': 'TestAgent/1.0',
          'x-forwarded-for': '10.0.0.1, 172.16.0.1',
        },
        originalUrl: '/api/test?query=1',
        method: 'POST',
        path: '/api/test',
        remoteAddress: '192.168.1.1',
      })
      const res = createMockResponse()

      middleware(req, res, () => {
        posthog.capture({ event: 'handler_event' })
      })
      await waitForFlushTimer(posthog)

      const batchEvents = getLastBatchEvents()
      expect(batchEvents).toBeDefined()

      const event = batchEvents!.find((e: any) => e.event === 'handler_event')
      expect(event).toBeDefined()
      expect(event.distinct_id).toBe('user-456')
      expect(event.properties.$session_id).toBe('session-123')
      expect(event.properties.$current_url).toBe('/api/test?query=1')
      expect(event.properties.$request_method).toBe('POST')
      expect(event.properties.$request_path).toBe('/api/test')
      expect(event.properties.$user_agent).toBe('TestAgent/1.0')
      expect(event.properties.$ip).toBe('10.0.0.1')
    })

    it('should sanitize tracing header values and preserve explicit capture properties', async () => {
      const middleware = createRequestContextMiddleware(posthog)
      const req = createMockRequest({
        headers: {
          'x-posthog-session-id': [' \u0000 session-123\t ', 'ignored'],
          'x-posthog-distinct-id': ' user-456\u0001 ',
        },
      })
      const res = createMockResponse()

      middleware(req, res, () => {
        posthog.capture({
          event: 'handler_event',
          properties: {
            $session_id: 'explicit-session',
          },
        })
      })
      await waitForFlushTimer(posthog)

      const batchEvents = getLastBatchEvents()
      const event = batchEvents!.find((e: any) => e.event === 'handler_event')
      expect(event.distinct_id).toBe('user-456')
      expect(event.properties.$session_id).toBe('explicit-session')
    })

    it('should not swallow errors thrown by downstream middleware', () => {
      const middleware = createRequestContextMiddleware(posthog)
      const error = new Error('downstream error')

      expect(() => {
        middleware(createMockRequest(), createMockResponse(), () => {
          throw error
        })
      }).toThrow(error)
    })
  })

  describe('error handler', () => {
    it('should keep setupExpressErrorHandler backwards compatible', () => {
      const app = { use: jest.fn() }

      setupExpressErrorHandler(posthog, app)

      expect(app.use).toHaveBeenCalledWith(expect.any(Function))
    })

    it('should capture exceptions with sanitized session and distinct headers', async () => {
      const handler = createErrorHandlerMiddleware(posthog)
      const error = new Error('Express error')
      const req = createMockRequest({
        headers: {
          'x-posthog-session-id': ' session-123\u0000 ',
          'x-posthog-distinct-id': ' user-456 ',
          'user-agent': 'TestAgent/1.0',
        },
        url: '/api/error',
        method: 'POST',
        path: '/api/error',
        remoteAddress: '192.168.1.1',
      })
      const res = createMockResponse({ statusCode: 503 })
      const next = jest.fn()

      handler(error, req, res, next)
      await waitForFlushTimer(posthog)

      expect(next).toHaveBeenCalledWith(error)
      const batchEvents = getLastBatchEvents()
      expect(batchEvents).toBeDefined()
      expect(batchEvents!.length).toBe(1)

      const event = batchEvents![0]
      expect(event.event).toBe('$exception')
      expect(event.distinct_id).toBe('user-456')
      expect(event.properties.$session_id).toBe('session-123')
      expect(event.properties.$current_url).toBe('/api/error')
      expect(event.properties.$request_method).toBe('POST')
      expect(event.properties.$request_path).toBe('/api/error')
      expect(event.properties.$user_agent).toBe('TestAgent/1.0')
      expect(event.properties.$response_status_code).toBe(503)
      expect(event.properties.$ip).toBe('192.168.1.1')
      expect(event.properties.$exception_list).toBeDefined()
    })
  })
})
