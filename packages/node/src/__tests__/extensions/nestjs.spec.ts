import { of, throwError, lastValueFrom } from 'rxjs'

import { PostHog } from '@/entrypoints/index.node'
import { PostHogInterceptor } from '@/extensions/nestjs'

jest.mock('../../version', () => ({ version: '1.2.3' }))

const mockedFetch = jest.spyOn(globalThis, 'fetch').mockImplementation()

/**
 * Deterministically drains all pending promises (including async chains like
 * captureException's buildEventMessage) and flushes any remaining queued events.
 */
const waitForFlushTimer = async (posthog: PostHog): Promise<void> => {
  await posthog.shutdown()
}

const getLastBatchEvents = (): any[] | undefined => {
  expect(mockedFetch).toHaveBeenCalledWith('http://example.com/batch/', expect.objectContaining({ method: 'POST' }))

  const call = mockedFetch.mock.calls.reverse().find((x) => (x[0] as string).includes('/batch/'))
  if (!call) {
    return undefined
  }
  return JSON.parse((call[1] as any).body as any).batch
}

const createMockContext = (overrides?: {
  headers?: Record<string, string>
  url?: string
  method?: string
  path?: string
  statusCode?: number
  remoteAddress?: string
}) => {
  const request = {
    url: overrides?.url ?? '/test-path',
    method: overrides?.method ?? 'GET',
    path: overrides?.path ?? '/test-path',
    headers: overrides?.headers ?? {},
    socket: { remoteAddress: overrides?.remoteAddress ?? '127.0.0.1' },
  }
  const response = {
    statusCode: overrides?.statusCode ?? 500,
  }
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  }
}

const createMockCallHandler = (error?: Error) => ({
  handle: () => (error ? throwError(() => error) : of(undefined)),
})

describe('PostHogInterceptor', () => {
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

  describe('context propagation', () => {
    it('should set context from request headers', async () => {
      const interceptor = new PostHogInterceptor(posthog)
      const context = createMockContext({
        headers: {
          'x-posthog-session-id': 'session-123',
          'x-posthog-distinct-id': 'user-456',
          'user-agent': 'TestAgent/1.0',
        },
        url: '/api/test',
        method: 'POST',
        path: '/api/test',
        remoteAddress: '192.168.1.1',
      })

      let capturedContext: any
      const handler = {
        handle: () => {
          capturedContext = posthog.getContext()
          return of({ success: true })
        },
      }

      await lastValueFrom(interceptor.intercept(context, handler))

      expect(capturedContext).toBeDefined()
      expect(capturedContext.sessionId).toBe('session-123')
      expect(capturedContext.distinctId).toBe('user-456')
      expect(capturedContext.properties.$current_url).toBe('/api/test')
      expect(capturedContext.properties.$request_method).toBe('POST')
      expect(capturedContext.properties.$request_path).toBe('/api/test')
      expect(capturedContext.properties.$user_agent).toBe('TestAgent/1.0')
      expect(capturedContext.properties.$ip).toBe('192.168.1.1')
    })

    it('should propagate context to capture calls in handler', async () => {
      const interceptor = new PostHogInterceptor(posthog)
      const context = createMockContext({
        headers: {
          'x-posthog-session-id': 'session-abc',
          'x-posthog-distinct-id': 'user-xyz',
        },
      })

      const handler = {
        handle: () => {
          posthog.capture({ event: 'handler_event' })
          return of({ success: true })
        },
      }

      await lastValueFrom(interceptor.intercept(context, handler))
      await waitForFlushTimer(posthog)

      const batchEvents = getLastBatchEvents()
      expect(batchEvents).toBeDefined()

      const event = batchEvents!.find((e: any) => e.event === 'handler_event')
      expect(event).toBeDefined()
      expect(event.distinct_id).toBe('user-xyz')
      expect(event.properties.$session_id).toBe('session-abc')
    })

    it('should pass through successful responses', async () => {
      const interceptor = new PostHogInterceptor(posthog)
      const context = createMockContext()
      const handler = { handle: () => of({ success: true }) }

      const result = await lastValueFrom(interceptor.intercept(context, handler))
      expect(result).toEqual({ success: true })
    })

    it('should not capture exceptions by default', async () => {
      const interceptor = new PostHogInterceptor(posthog)
      const error = new Error('should not be captured')
      const context = createMockContext()

      await expect(lastValueFrom(interceptor.intercept(context, createMockCallHandler(error)))).rejects.toThrow(error)
      await waitForFlushTimer(posthog)

      const batchCalls = mockedFetch.mock.calls.filter((c) => (c[0] as string).includes('/batch/'))
      expect(batchCalls.length).toBe(0)
    })

    it('should extract first IP from comma-separated x-forwarded-for', async () => {
      const interceptor = new PostHogInterceptor(posthog)
      const context = createMockContext({
        headers: { 'x-forwarded-for': '10.0.0.1, 172.16.0.1, 192.168.1.1' },
      })

      let capturedContext: any
      const handler = {
        handle: () => {
          capturedContext = posthog.getContext()
          return of({ success: true })
        },
      }

      await lastValueFrom(interceptor.intercept(context, handler))
      expect(capturedContext.properties.$ip).toBe('10.0.0.1')
    })
  })

  describe('exception capture (captureExceptions: true)', () => {
    let interceptor: PostHogInterceptor

    beforeEach(() => {
      interceptor = new PostHogInterceptor(posthog, { captureExceptions: true })
    })

    it('should capture exception with correct properties', async () => {
      const error = new Error('test NestJS error')
      const context = createMockContext({
        headers: {
          'x-posthog-session-id': 'session-123',
          'x-posthog-distinct-id': 'user-456',
          'user-agent': 'TestAgent/1.0',
        },
        url: '/api/test',
        method: 'POST',
        path: '/api/test',
        statusCode: 500,
        remoteAddress: '192.168.1.1',
      })

      await expect(lastValueFrom(interceptor.intercept(context, createMockCallHandler(error)))).rejects.toThrow(error)
      await waitForFlushTimer(posthog)

      const batchEvents = getLastBatchEvents()
      expect(batchEvents).toBeDefined()
      expect(batchEvents!.length).toBe(1)

      const event = batchEvents![0]
      expect(event.event).toBe('$exception')
      expect(event.distinct_id).toBe('user-456')
      expect(event.properties.$session_id).toBe('session-123')
      expect(event.properties.$current_url).toBe('/api/test')
      expect(event.properties.$request_method).toBe('POST')
      expect(event.properties.$request_path).toBe('/api/test')
      expect(event.properties.$user_agent).toBe('TestAgent/1.0')
      expect(event.properties.$response_status_code).toBe(500)
      expect(event.properties.$ip).toBe('192.168.1.1')
      expect(event.properties.$exception_list).toBeDefined()
    })

    it('should skip previously captured errors', async () => {
      const error = new Error('already captured') as any
      error.__posthog_previously_captured_error = true
      const context = createMockContext()

      await expect(lastValueFrom(interceptor.intercept(context, createMockCallHandler(error)))).rejects.toThrow(error)
      await waitForFlushTimer(posthog)

      const batchCalls = mockedFetch.mock.calls.filter((c) => (c[0] as string).includes('/batch/'))
      expect(batchCalls.length).toBe(0)
    })

    it('should re-throw the exception', async () => {
      const error = new Error('should be re-thrown')
      const context = createMockContext()

      await expect(lastValueFrom(interceptor.intercept(context, createMockCallHandler(error)))).rejects.toThrow(error)
    })

    it('should handle missing headers gracefully', async () => {
      const error = new Error('no headers error')
      const context = createMockContext({ headers: {} })

      await expect(lastValueFrom(interceptor.intercept(context, createMockCallHandler(error)))).rejects.toThrow(error)
      await waitForFlushTimer(posthog)

      const batchEvents = getLastBatchEvents()
      expect(batchEvents).toBeDefined()
      expect(batchEvents!.length).toBe(1)

      const event = batchEvents![0]
      expect(event.event).toBe('$exception')
      expect(event.distinct_id).toBeDefined()
      expect(event.properties.$session_id).toBeUndefined()
      expect(event.properties.$user_agent).toBeUndefined()
    })

    it('should use x-forwarded-for over socket remoteAddress', async () => {
      const error = new Error('ip test error')
      const context = createMockContext({
        headers: { 'x-forwarded-for': '10.0.0.1' },
        remoteAddress: '127.0.0.1',
      })

      await expect(lastValueFrom(interceptor.intercept(context, createMockCallHandler(error)))).rejects.toThrow(error)
      await waitForFlushTimer(posthog)

      const batchEvents = getLastBatchEvents()
      expect(batchEvents![0].properties.$ip).toBe('10.0.0.1')
    })

    it('should extract first IP from comma-separated x-forwarded-for', async () => {
      const error = new Error('multi ip error')
      const context = createMockContext({
        headers: { 'x-forwarded-for': '10.0.0.1, 172.16.0.1, 192.168.1.1' },
      })

      await expect(lastValueFrom(interceptor.intercept(context, createMockCallHandler(error)))).rejects.toThrow(error)
      await waitForFlushTimer(posthog)

      const batchEvents = getLastBatchEvents()
      expect(batchEvents![0].properties.$ip).toBe('10.0.0.1')
    })

    it('should skip 4xx HttpException-like errors by default', async () => {
      const error: any = new Error('Not Found')
      error.getStatus = () => 404
      const context = createMockContext()

      await expect(lastValueFrom(interceptor.intercept(context, createMockCallHandler(error)))).rejects.toThrow(error)
      await waitForFlushTimer(posthog)

      const batchCalls = mockedFetch.mock.calls.filter((c) => (c[0] as string).includes('/batch/'))
      expect(batchCalls.length).toBe(0)
    })

    it('should capture 5xx HttpException-like errors', async () => {
      const error: any = new Error('Internal Server Error')
      error.getStatus = () => 500
      const context = createMockContext()

      await expect(lastValueFrom(interceptor.intercept(context, createMockCallHandler(error)))).rejects.toThrow(error)
      await waitForFlushTimer(posthog)

      const batchEvents = getLastBatchEvents()
      expect(batchEvents).toBeDefined()
      expect(batchEvents![0].event).toBe('$exception')
      expect(batchEvents![0].properties.$response_status_code).toBe(500)
    })
  })

  describe('exception capture with custom minStatusToCapture', () => {
    it('should capture 4xx when minStatusToCapture is set to 400', async () => {
      const interceptor = new PostHogInterceptor(posthog, {
        captureExceptions: { minStatusToCapture: 400 },
      })
      const error: any = new Error('Not Found')
      error.getStatus = () => 404
      const context = createMockContext()

      await expect(lastValueFrom(interceptor.intercept(context, createMockCallHandler(error)))).rejects.toThrow(error)
      await waitForFlushTimer(posthog)

      const batchEvents = getLastBatchEvents()
      expect(batchEvents).toBeDefined()
      expect(batchEvents![0].event).toBe('$exception')
    })
  })
})
