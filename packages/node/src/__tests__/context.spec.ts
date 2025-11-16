import { PostHog } from '@/entrypoints/index.node'
import { waitForPromises } from './utils'

jest.mock('../version', () => ({ version: '1.2.3' }))

const mockedFetch = jest.spyOn(globalThis, 'fetch').mockImplementation()

const waitForFlush = async (): Promise<void> => {
  await waitForPromises()
  jest.runOnlyPendingTimers()
  await waitForPromises()
}

const getLastBatchEvents = (): any[] | undefined => {
  const call = mockedFetch.mock.calls.reverse().find((x) => (x[0] as string).includes('/batch/'))
  if (!call) return undefined
  return JSON.parse((call[1] as any).body as any).batch
}

describe('PostHog Context', () => {
  let posthog: PostHog

  jest.useFakeTimers()

  beforeEach(() => {
    jest.clearAllMocks()
    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      flushAt: 1,
      fetchRetryCount: 0,
      disableCompression: true,
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

  it('should attach context tags to events', async () => {
    posthog.withContext({ tags: { plan: 'premium', region: 'us-east' } }, () => {
      posthog.capture({ distinctId: 'user-1', event: 'test_event' })
    })

    await waitForFlush()

    const events = getLastBatchEvents()
    expect(events).toHaveLength(1)
    expect(events?.[0].properties).toMatchObject({
      plan: 'premium',
      region: 'us-east',
    })
  })

  it('should allow explicit properties to override context tags', async () => {
    posthog.withContext({ tags: { plan: 'free', region: 'us-west' } }, () => {
      posthog.capture({
        distinctId: 'user-2',
        event: 'test_event',
        properties: { plan: 'enterprise' },
      })
    })

    await waitForFlush()

    const events = getLastBatchEvents()
    expect(events?.[0].properties).toMatchObject({
      plan: 'enterprise',
      region: 'us-west',
    })
  })

  it('should set $session_id from context sessionId', async () => {
    posthog.withContext({ sessionId: 'session-123', tags: { env: 'prod' } }, () => {
      posthog.capture({ distinctId: 'user-3', event: 'test_event' })
    })

    await waitForFlush()

    const events = getLastBatchEvents()
    expect(events?.[0].properties).toMatchObject({
      $session_id: 'session-123',
      env: 'prod',
    })
  })

  it('should use distinctId from context if not explicitly provided', async () => {
    posthog.withContext({ distinctId: 'context-user' }, () => {
      posthog.capture({ event: 'test_event' })
    })

    await waitForFlush()

    const events = getLastBatchEvents()
    expect(events?.[0].distinct_id).toBe('context-user')
  })

  it('should isolate contexts by default (fresh: true)', async () => {
    posthog.withContext({ tags: { outer: 'value1' } }, () => {
      posthog.withContext({ tags: { inner: 'value2' } }, () => {
        posthog.capture({ distinctId: 'user-4', event: 'test_event' })
      })
    })

    await waitForFlush()

    const events = getLastBatchEvents()
    expect(events?.[0].properties).toMatchObject({
      inner: 'value2',
    })
    expect(events?.[0].properties.outer).toBeUndefined()
  })

  it('should merge contexts when fresh: false', async () => {
    posthog.withContext({ tags: { outer: 'value1', shared: 'parent' } }, () => {
      posthog.withContext(
        { tags: { inner: 'value2', shared: 'child' } },
        () => {
          posthog.capture({ distinctId: 'user-5', event: 'test_event' })
        },
        { fresh: false }
      )
    })

    await waitForPromises()
    jest.runOnlyPendingTimers()
    await waitForPromises()

    const events = getLastBatchEvents()
    expect(events?.[0].properties).toMatchObject({
      outer: 'value1',
      inner: 'value2',
      shared: 'child',
    })
  })

  it('should merge sessionId from parent context', async () => {
    posthog.withContext({ sessionId: 'session-parent', tags: { level: '1' } }, () => {
      posthog.withContext(
        { tags: { level: '2' } },
        () => {
          posthog.capture({ distinctId: 'user-6', event: 'test_event' })
        },
        { fresh: false }
      )
    })

    await waitForFlush()

    const events = getLastBatchEvents()
    expect(events?.[0].properties).toMatchObject({
      $session_id: 'session-parent',
      level: '2',
    })
  })

  it('should use personless processing when no distinctId provided', async () => {
    posthog.withContext({ tags: { plan: 'free' } }, () => {
      posthog.capture({ event: 'test_event' })
    })

    await waitForFlush()

    const events = getLastBatchEvents()
    expect(events).toHaveLength(1)

    expect(events?.[0].distinct_id).toBeTruthy()
    expect(typeof events?.[0].distinct_id).toBe('string')
    expect(events?.[0].properties).toMatchObject({
      $process_person_profile: false,
      plan: 'free',
    })
  })

  it('should isolate contexts across 50 concurrent async operations with random delays', async () => {
    jest.useRealTimers()

    const operations = Array.from({ length: 50 }, (_, index) => {
      return posthog.withContext({ tags: { index, operation: `op-${index}` } }, async () => {
        const delay = Math.floor(Math.random() * 200)

        await new Promise((r) => setTimeout(r, delay))

        posthog.capture({
          distinctId: `user-${index}`,
          event: 'concurrent_test',
          properties: { step: 'after_delay' },
        })
      })
    })

    jest.useFakeTimers()

    await Promise.all(operations)

    await waitForFlush()

    const allEvents: any[] = []
    mockedFetch.mock.calls.forEach((call) => {
      if ((call[0] as string).includes('/batch/')) {
        const batch = JSON.parse((call[1] as any).body as any).batch
        allEvents.push(...batch)
      }
    })

    expect(allEvents).toHaveLength(50)

    const capturedIndices = allEvents.map((event) => event.properties.index).sort((a, b) => a - b)
    const expectedIndices = Array.from({ length: 50 }, (_, i) => i)

    expect(capturedIndices).toEqual(expectedIndices)
  })
})
