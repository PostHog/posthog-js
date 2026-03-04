import { PostHog } from '@/entrypoints/index.node'
import { PostHogExceptionFilter } from '@/extensions/nestjs'
import { waitForPromises } from '../utils'

jest.mock('../../version', () => ({ version: '1.2.3' }))

const mockedFetch = jest.spyOn(globalThis, 'fetch').mockImplementation()

const getLastBatchEvents = (): any[] | undefined => {
  expect(mockedFetch).toHaveBeenCalledWith('http://example.com/batch/', expect.objectContaining({ method: 'POST' }))

  const call = mockedFetch.mock.calls.reverse().find((x) => (x[0] as string).includes('/batch/'))
  if (!call) {
    return undefined
  }
  return JSON.parse((call[1] as any).body as any).batch
}

const createMockHost = (overrides?: {
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

describe('PostHogExceptionFilter', () => {
  let posthog: PostHog
  let filter: PostHogExceptionFilter

  jest.useFakeTimers()

  beforeEach(() => {
    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      fetchRetryCount: 0,
      disableCompression: true,
    })

    filter = new PostHogExceptionFilter(posthog)

    mockedFetch.mockResolvedValue({
      status: 200,
      text: () => Promise.resolve('ok'),
      json: () => Promise.resolve({ status: 'ok' }),
    } as any)
  })

  afterEach(async () => {
    await posthog.shutdown()
  })

  it('should capture exception with correct properties', async () => {
    const error = new Error('test NestJS error')
    const host = createMockHost({
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

    expect(() => filter.catch(error, host)).toThrow(error)

    await waitForPromises()
    jest.runOnlyPendingTimers()
    await waitForPromises()

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

  it('should skip previously captured errors', () => {
    const error = new Error('already captured') as any
    error.__posthog_previously_captured_error = true
    const host = createMockHost()

    expect(() => filter.catch(error, host)).toThrow(error)
    expect(mockedFetch).not.toHaveBeenCalled()
  })

  it('should re-throw the exception', () => {
    const error = new Error('should be re-thrown')
    const host = createMockHost()

    expect(() => filter.catch(error, host)).toThrow(error)
  })

  it('should handle missing headers gracefully', async () => {
    const error = new Error('no headers error')
    const host = createMockHost({ headers: {} })

    expect(() => filter.catch(error, host)).toThrow(error)

    await waitForPromises()
    jest.runOnlyPendingTimers()
    await waitForPromises()

    const batchEvents = getLastBatchEvents()
    expect(batchEvents).toBeDefined()
    expect(batchEvents!.length).toBe(1)

    const event = batchEvents![0]
    expect(event.event).toBe('$exception')
    // Without distinct_id header, should use generated UUID
    expect(event.distinct_id).toBeDefined()
    expect(event.properties.$session_id).toBeUndefined()
    expect(event.properties.$user_agent).toBeUndefined()
  })

  it('should use x-forwarded-for over socket remoteAddress', async () => {
    const error = new Error('ip test error')
    const host = createMockHost({
      headers: { 'x-forwarded-for': '10.0.0.1' },
      remoteAddress: '127.0.0.1',
    })

    expect(() => filter.catch(error, host)).toThrow(error)

    await waitForPromises()
    jest.runOnlyPendingTimers()
    await waitForPromises()

    const batchEvents = getLastBatchEvents()
    expect(batchEvents![0].properties.$ip).toBe('10.0.0.1')
  })
})
