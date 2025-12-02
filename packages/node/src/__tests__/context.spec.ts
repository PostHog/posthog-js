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
    posthog.withContext({ properties: { plan: 'premium', region: 'us-east' } }, () => {
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
    posthog.withContext({ properties: { plan: 'free', region: 'us-west' } }, () => {
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
    posthog.withContext({ sessionId: 'session-123', properties: { env: 'prod' } }, () => {
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

  it('should merge contexts by default (fresh: false)', async () => {
    posthog.withContext({ properties: { outer: 'value1', shared: 'parent' } }, () => {
      posthog.withContext({ properties: { inner: 'value2', shared: 'child' } }, () => {
        posthog.capture({ distinctId: 'user-4', event: 'test_event' })
      })
    })

    await waitForFlush()

    const events = getLastBatchEvents()
    expect(events?.[0].properties).toMatchObject({
      outer: 'value1',
      inner: 'value2',
      shared: 'child',
    })
  })

  it('should isolate contexts when inherit: false', async () => {
    posthog.withContext({ properties: { outer: 'value1' } }, () => {
      posthog.withContext(
        { properties: { inner: 'value2' } },
        () => {
          posthog.capture({ distinctId: 'user-5', event: 'test_event' })
        },
        { inherit: false }
      )
    })

    await waitForPromises()
    jest.runOnlyPendingTimers()
    await waitForPromises()

    const events = getLastBatchEvents()
    expect(events?.[0].properties).toMatchObject({
      inner: 'value2',
    })
    expect(events?.[0].properties.outer).toBeUndefined()
  })

  it('should merge sessionId from parent context', async () => {
    posthog.withContext({ sessionId: 'session-parent', properties: { level: '1' } }, () => {
      posthog.withContext({ properties: { level: '2' } }, () => {
        posthog.capture({ distinctId: 'user-6', event: 'test_event' })
      })
    })

    await waitForFlush()

    const events = getLastBatchEvents()
    expect(events?.[0].properties).toMatchObject({
      $session_id: 'session-parent',
      level: '2',
    })
  })

  it('should use personless processing when no distinctId provided', async () => {
    posthog.withContext({ properties: { plan: 'free' } }, () => {
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
      return posthog.withContext({ properties: { index, operation: `op-${index}` } }, async () => {
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

  it('should properly inherit and restore context through nested enter/exit operations', async () => {
    // Enter context A
    posthog.withContext({ properties: { contextA: 'valueA', level: 'A' } }, () => {
      // Enter context B (inherits from A by default)
      posthog.withContext({ properties: { contextB: 'valueB', level: 'B' } }, () => {
        // Enter context C1 (inherits from B, which has A's stuff)
        posthog.withContext({ properties: { contextC1: 'valueC1', level: 'C1' } }, () => {
          // Event 1: Should have A, B, and C1 context
          posthog.capture({ distinctId: 'user-nested', event: 'event_in_C1' })
        })

        // Exit C1 - Event 2: Should have A and B, but not C1
        posthog.capture({ distinctId: 'user-nested', event: 'event_after_C1' })

        // Enter context C2 (inherits from B, which still has A's stuff)
        posthog.withContext({ properties: { contextC2: 'valueC2', level: 'C2' } }, () => {
          // Event 3: Should have A, B, and C2 (but not C1)
          posthog.capture({ distinctId: 'user-nested', event: 'event_in_C2' })
        })

        // Exit C2 - Event 4: Should have A and B again (no C1 or C2)
        posthog.capture({ distinctId: 'user-nested', event: 'event_after_C2' })
      })
    })

    await waitForFlush()

    const allEvents: any[] = []
    mockedFetch.mock.calls.forEach((call) => {
      if ((call[0] as string).includes('/batch/')) {
        const batch = JSON.parse((call[1] as any).body as any).batch
        allEvents.push(...batch)
      }
    })

    expect(allEvents).toHaveLength(4)

    // Event 1: In context C1 (has A, B, C1)
    const eventInC1 = allEvents.find((e) => e.event === 'event_in_C1')
    expect(eventInC1?.properties).toMatchObject({
      contextA: 'valueA',
      contextB: 'valueB',
      contextC1: 'valueC1',
      level: 'C1', // C1 overrides level
    })
    expect(eventInC1?.properties.contextC2).toBeUndefined()

    // Event 2: After exiting C1 (has A, B, but not C1)
    const eventAfterC1 = allEvents.find((e) => e.event === 'event_after_C1')
    expect(eventAfterC1?.properties).toMatchObject({
      contextA: 'valueA',
      contextB: 'valueB',
      level: 'B', // Back to B's level
    })
    expect(eventAfterC1?.properties.contextC1).toBeUndefined()
    expect(eventAfterC1?.properties.contextC2).toBeUndefined()

    // Event 3: In context C2 (has A, B, C2, but not C1)
    const eventInC2 = allEvents.find((e) => e.event === 'event_in_C2')
    expect(eventInC2?.properties).toMatchObject({
      contextA: 'valueA',
      contextB: 'valueB',
      contextC2: 'valueC2',
      level: 'C2', // C2 overrides level
    })
    expect(eventInC2?.properties.contextC1).toBeUndefined()

    // Event 4: After exiting C2 (has A, B again, no C1 or C2)
    const eventAfterC2 = allEvents.find((e) => e.event === 'event_after_C2')
    expect(eventAfterC2?.properties).toMatchObject({
      contextA: 'valueA',
      contextB: 'valueB',
      level: 'B', // Back to B's level again
    })
    expect(eventAfterC2?.properties.contextC1).toBeUndefined()
    expect(eventAfterC2?.properties.contextC2).toBeUndefined()
  })
})
