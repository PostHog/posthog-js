import { EventEmitter } from 'node:events'
import type { IncomingHttpHeaders } from 'node:http'
import { PostHog } from '@/entrypoints/index.node'
import { setupExpressErrorHandler, setupExpressRequestContext } from '@/extensions/express'

vi.mock('../../version', () => ({ version: '1.2.3' }))

const mockedFetch = vi.spyOn(globalThis, 'fetch').mockImplementation()

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

const createMockResponse = (overrides?: { statusCode?: number; headersSent?: boolean; destroyed?: boolean }): any =>
  Object.assign(new EventEmitter(), {
    statusCode: 200,
    headersSent: false,
    destroyed: false,
    ...overrides,
  })

const finishResponse = (res: any, statusCode: number): void => {
  res.statusCode = statusCode
  res.headersSent = true
  res.emit('finish')
  res.emit('close')
}

const createRequestContextMiddleware = (posthog: PostHog): any => {
  const app = { use: vi.fn() }
  setupExpressRequestContext(posthog, app)
  return app.use.mock.calls[0][0]
}

const createErrorHandlerMiddleware = (posthog: PostHog): any => {
  const app = { use: vi.fn() }
  setupExpressErrorHandler(posthog, app)
  return app.use.mock.calls[0][0]
}

const createPostHog = (options: Record<string, any> = {}): PostHog =>
  new PostHog('TEST_API_KEY', {
    host: 'http://example.com',
    fetchRetryCount: 0,
    disableCompression: true,
    flushAt: 1,
    flushInterval: 0,
    ...options,
  })

describe('Express extension', () => {
  let posthog: PostHog

  beforeEach(() => {
    posthog = createPostHog()

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
      const app = { use: vi.fn() }

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

    it.each([
      {
        name: 'strips request path search and preserves URL hash by default',
        options: {},
        expectedCurrentUrl: '/api/test?token=secret#details',
        expectedRequestPath: '/api/test#details',
      },
      {
        name: 'strips request URL hashes when disable_capture_url_hashes is enabled',
        options: { disable_capture_url_hashes: true },
        expectedCurrentUrl: '/api/test?token=secret',
        expectedRequestPath: '/api/test',
      },
    ])('should $name', async ({ options, expectedCurrentUrl, expectedRequestPath }) => {
      await posthog.shutdown()
      posthog = createPostHog(options)
      const middleware = createRequestContextMiddleware(posthog)
      const req = createMockRequest({
        originalUrl: '/api/test?token=secret#details',
        path: '/api/test?token=secret#details',
      })
      const res = createMockResponse()

      middleware(req, res, () => {
        posthog.capture({ event: 'handler_event' })
      })
      await waitForFlushTimer(posthog)

      const batchEvents = getLastBatchEvents()
      const event = batchEvents!.find((e: any) => e.event === 'handler_event')
      expect(event.properties.$current_url).toBe(expectedCurrentUrl)
      expect(event.properties.$request_path).toBe(expectedRequestPath)
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
    it.each([
      { errorProperties: { status: 404 }, finalStatus: 404 },
      { errorProperties: { statusCode: 404 }, finalStatus: 404 },
      { errorProperties: { status: 503 }, finalStatus: 503 },
      { errorProperties: { statusCode: 503 }, finalStatus: 503 },
      { errorProperties: {}, finalStatus: 500 },
      { errorProperties: { status: 404 }, finalStatus: 503 },
      { errorProperties: { status: 500 }, finalStatus: 200 },
    ])(
      'should capture the final response status $finalStatus for $errorProperties',
      async ({ errorProperties, finalStatus }) => {
        const handler = createErrorHandlerMiddleware(posthog)
        const error = Object.assign(new Error('Express error'), errorProperties)
        const res = createMockResponse()
        const next = vi.fn()

        handler(error, createMockRequest(), res, next)
        expect(next).toHaveBeenCalledOnce()
        expect(next).toHaveBeenCalledWith(error)
        await vi.advanceTimersByTimeAsync(20)
        finishResponse(res, finalStatus)
        await waitForFlushTimer(posthog)

        const events = getLastBatchEvents()!
        expect(events).toHaveLength(1)
        expect(events[0].properties.$response_status_code).toBe(finalStatus)
        expect(res.listenerCount('finish')).toBe(0)
        expect(res.listenerCount('close')).toBe(0)
      }
    )

    it('should keep capture pending through shutdown until the response completes', async () => {
      const res = createMockResponse()
      posthog.withContext({ distinctId: 'request-user', properties: { requestMarker: 'original' } }, () => {
        createErrorHandlerMiddleware(posthog)(new Error('Delayed response'), createMockRequest(), res, vi.fn())
      })
      const shutdown = posthog.shutdown()
      await vi.advanceTimersByTimeAsync(20)
      expect(mockedFetch).not.toHaveBeenCalled()

      posthog.withContext({ distinctId: 'other-user', properties: { requestMarker: 'other' } }, () => {
        finishResponse(res, 503)
      })
      await shutdown

      const events = getLastBatchEvents()!
      expect(events).toHaveLength(1)
      expect(events[0].distinct_id).toBe('request-user')
      expect(events[0].properties.requestMarker).toBe('original')
      expect(events[0].properties.$response_status_code).toBe(503)
    })

    it('should expose the final status to before_send filtering', async () => {
      await posthog.shutdown()
      const beforeSend = vi.fn((event) => (event.properties.$response_status_code < 500 ? null : event))
      posthog = createPostHog({ before_send: beforeSend })
      const res = createMockResponse()

      createErrorHandlerMiddleware(posthog)(new Error('Not found'), createMockRequest(), res, vi.fn())
      finishResponse(res, 404)
      await waitForFlushTimer(posthog)

      expect(beforeSend).toHaveBeenCalledOnce()
      expect(beforeSend.mock.calls[0][0].properties.$response_status_code).toBe(404)
      expect(mockedFetch).not.toHaveBeenCalled()
    })

    it.each([false, true])('should capture a closed response with headersSent=%s', async (headersSent) => {
      const res = createMockResponse()
      createErrorHandlerMiddleware(posthog)(new Error('Connection closed'), createMockRequest(), res, vi.fn())
      res.statusCode = 503
      res.headersSent = headersSent
      res.destroyed = true
      res.emit('close')
      await waitForFlushTimer(posthog)

      const events = getLastBatchEvents()!
      expect(events).toHaveLength(1)
      if (headersSent) {
        expect(events[0].properties.$response_status_code).toBe(503)
      } else {
        expect(events[0].properties).not.toHaveProperty('$response_status_code')
      }
      expect(res.listenerCount('finish')).toBe(0)
      expect(res.listenerCount('close')).toBe(0)
    })

    it.each([
      { headersSent: true, destroyed: false, expectedStatus: 503 },
      { headersSent: true, destroyed: true, expectedStatus: 503 },
      { headersSent: false, destroyed: true, expectedStatus: undefined },
    ])(
      'should not wait for an already committed or destroyed response: $headersSent/$destroyed',
      async ({ headersSent, destroyed, expectedStatus }) => {
        const res = createMockResponse({ statusCode: 503, headersSent, destroyed })
        createErrorHandlerMiddleware(posthog)(new Error('Late error'), createMockRequest(), res, vi.fn())
        await waitForFlushTimer(posthog)

        expect(getLastBatchEvents()![0].properties.$response_status_code).toBe(expectedStatus)
        expect(res.listenerCount('finish')).toBe(0)
        expect(res.listenerCount('close')).toBe(0)
      }
    )

    it('should forward previously captured errors without waiting for the response', async () => {
      const error = Object.assign(new Error('Already captured'), { __posthog_previously_captured_error: true })
      const next = vi.fn()
      const res = createMockResponse()

      createErrorHandlerMiddleware(posthog)(error, createMockRequest(), res, next)
      await waitForFlushTimer(posthog)

      expect(next).toHaveBeenCalledOnce()
      expect(next).toHaveBeenCalledWith(error)
      expect(mockedFetch).not.toHaveBeenCalled()
      expect(res.listenerCount('finish')).toBe(0)
      expect(res.listenerCount('close')).toBe(0)
    })

    it('should keep setupExpressErrorHandler backwards compatible', () => {
      const app = { use: vi.fn() }

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
      const next = vi.fn()

      handler(error, req, res, next)
      finishResponse(res, 503)
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
