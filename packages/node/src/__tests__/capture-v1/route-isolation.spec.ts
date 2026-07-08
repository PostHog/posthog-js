import { PostHogPersistedProperty } from '@posthog/core'

import { PostHog } from '@/entrypoints/index.node'

import { V1WiringHarness, v1Response, waitForFlushTimer } from '../utils/v1-wiring'

jest.mock('../../version', () => ({ version: '1.2.3' }))

// Regression coverage for the mixed-batch double-delivery risk (H1): with v1 and legacy $ai_*
// events sharing a flush cycle, a failure on the legacy leg must not roll back or re-send the
// events already accepted on the V1 leg. Route partitioning gives each transport its own queue.
describe('capture v1 route isolation (Node SDK)', () => {
  jest.useFakeTimers()

  const harness = new V1WiringHarness()

  const aiQueueEvents = (posthog: PostHog): string[] =>
    (posthog.getPersistedProperty(PostHogPersistedProperty.AiQueue) || []).map((item: any) => item.message.event)

  const analyticsQueueEvents = (posthog: PostHog): string[] =>
    (posthog.getPersistedProperty(PostHogPersistedProperty.Queue) || []).map((item: any) => item.message.event)

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'info').mockImplementation(() => {})
    harness.useDefaultRouting()
  })

  afterEach(async () => {
    await harness.cleanup()
    jest.clearAllMocks()
  })

  it('keeps V1-accepted events from being re-sent when the legacy AI leg fails', async () => {
    // v1 endpoint accepts everything; the legacy /batch/ leg (AI route) fails with a network error.
    harness.fetch.mockImplementation((url: any) =>
      (url as string).includes('/i/v1/analytics/events')
        ? Promise.resolve(v1Response())
        : Promise.reject(new Error('network down'))
    )

    const posthog = harness.makeClient({ captureMode: 'v1' })
    posthog.capture({ distinctId: 'u', event: 'custom', properties: { x: 1 } })
    posthog.capture({ distinctId: 'u', event: '$ai_generation', properties: { $ai_model: 'gpt' } })
    await waitForFlushTimer()

    // Analytics route delivered its batch to V1 exactly once; the AI route attempted /batch/ and failed.
    expect(harness.eventsIn('/i/v1/analytics/events')).toEqual(['custom'])
    expect(harness.callsTo('/batch/').length).toBeGreaterThanOrEqual(1)

    // The failed AI event is retained on its isolated queue; the accepted V1 event is gone.
    expect(aiQueueEvents(posthog)).toEqual(['$ai_generation'])
    expect(analyticsQueueEvents(posthog)).toEqual([])

    // Recover the legacy leg and flush again.
    harness.useDefaultRouting()
    await posthog.flush()

    // The V1 event was never re-sent (still a single delivery); the AI event now reaches /batch/.
    expect(harness.eventsIn('/i/v1/analytics/events')).toEqual(['custom'])
    expect(harness.eventsIn('/batch/')).toContain('$ai_generation')
    expect(aiQueueEvents(posthog)).toEqual([])
  })

  it('flushes each route as its own homogeneous request (no mixed batch)', async () => {
    const posthog = harness.makeClient({ captureMode: 'v1' })
    posthog.capture({ distinctId: 'u', event: 'a', properties: {} })
    posthog.capture({ distinctId: 'u', event: '$ai_generation', properties: {} })
    posthog.capture({ distinctId: 'u', event: 'b', properties: {} })
    await waitForFlushTimer()

    // Every /batch/ request holds only AI events; every v1 request holds only non-AI events.
    for (const [, options] of harness.callsTo('/batch/')) {
      const events = JSON.parse(options.body).batch.map((e: any) => e.event)
      expect(events.every((name: string) => name.startsWith('$ai_'))).toBe(true)
    }
    for (const [, options] of harness.callsTo('/i/v1/analytics/events')) {
      const events = JSON.parse(options.body).batch.map((e: any) => e.event)
      expect(events.some((name: string) => name.startsWith('$ai_'))).toBe(false)
    }
    expect(harness.eventsIn('/i/v1/analytics/events')).toEqual(['a', 'b'])
    expect(harness.eventsIn('/batch/')).toEqual(['$ai_generation'])
  })
})
