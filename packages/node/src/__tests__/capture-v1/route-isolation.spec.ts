import { PostHogPersistedProperty } from '@posthog/core'

import { CaptureError, PostHog } from '@/entrypoints/index.node'

import { AI_CAPTURE_PATH, ANALYTICS_CAPTURE_PATH, v1Response } from '../utils'
import { V1WiringHarness, waitForFlushTimer } from '../utils/v1-wiring'

vi.mock('../../version', () => ({ version: '1.2.3' }))

// With analytics and captureAi events sharing a flush cycle, a failure on one lane must not roll
// back or re-send the events already accepted on the other. Each lane has its own queue.
describe('capture lane isolation (Node SDK)', () => {
  vi.useFakeTimers()

  const harness = new V1WiringHarness()

  const queuedEvents = (posthog: PostHog, key: PostHogPersistedProperty): string[] =>
    (posthog.getPersistedProperty(key) || []).map((item: any) => item.message.event)

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    harness.useDefaultRouting()
  })

  afterEach(async () => {
    await harness.cleanup()
    vi.clearAllMocks()
  })

  it('keeps analytics events from being re-sent when the AI lane fails', async () => {
    harness.fetch.mockImplementation((url: any) =>
      (url as string).includes(ANALYTICS_CAPTURE_PATH)
        ? Promise.resolve(v1Response())
        : Promise.reject(new Error('network down'))
    )

    const posthog = harness.makeClient()
    const errors: Error[] = []
    posthog.on('error', (error) => errors.push(error))
    posthog.capture({ distinctId: 'u', event: 'custom', properties: { x: 1 } })
    posthog.captureAi({ distinctId: 'u', event: '$ai_generation', properties: { $ai_model: 'gpt-4o-mini' } })
    await waitForFlushTimer()
    await posthog.flush()

    expect(harness.eventsIn(ANALYTICS_CAPTURE_PATH)).toEqual(['custom'])
    expect(harness.callsTo(AI_CAPTURE_PATH)).toHaveLength(1)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(CaptureError)
    expect((errors[0] as CaptureError).endpoint).toBe(AI_CAPTURE_PATH)

    // The sender owns retries, so the failed AI batch is reported and consumed rather than requeued.
    expect(queuedEvents(posthog, PostHogPersistedProperty.AiCaptureQueue)).toEqual([])
    expect(queuedEvents(posthog, PostHogPersistedProperty.Queue)).toEqual([])

    harness.useDefaultRouting()
    const callsBeforeRecovery = harness.fetch.mock.calls.length
    await posthog.flush()
    expect(harness.fetch.mock.calls.length).toBe(callsBeforeRecovery)
    expect(harness.eventsIn(ANALYTICS_CAPTURE_PATH)).toEqual(['custom'])
  })

  it('flushes each lane as its own homogeneous request (no mixed batch)', async () => {
    const posthog = harness.makeClient()
    posthog.capture({ distinctId: 'u', event: 'a', properties: {} })
    posthog.captureAi({ distinctId: 'u', event: '$ai_span', properties: {} })
    posthog.capture({ distinctId: 'u', event: '$ai_generation', properties: {} })
    await waitForFlushTimer()
    await posthog.flush()

    expect(harness.eventsIn(ANALYTICS_CAPTURE_PATH)).toEqual(['a', '$ai_generation'])
    expect(harness.eventsIn(AI_CAPTURE_PATH)).toEqual(['$ai_span'])
    expect(harness.callsTo('/batch/')).toHaveLength(0)
  })
})
