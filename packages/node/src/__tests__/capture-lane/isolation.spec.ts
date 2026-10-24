import { CaptureError, PostHog } from '@/entrypoints/index.node'

import { AI_CAPTURE_PATH, ANALYTICS_CAPTURE_PATH, captureEvents, v1Response } from '../utils'
import { V1WiringHarness, routeByUrl, waitForFlushTimer } from '../utils/v1-wiring'

vi.mock('../../version', () => ({ version: '1.2.3' }))

const ANALYTICS_UUID = '0198c0de-0000-7000-8000-000000000001'

const errorResponse = (status: number): any => ({
  status,
  text: () => Promise.resolve(''),
  headers: { get: () => null },
  body: null,
})

/** Holds every request to `path` open until `release()`, which also lets later ones through; other URLs answer normally. */
function holdLane(harness: V1WiringHarness, path: string): { release: () => void } {
  const pending: (() => void)[] = []
  let held = true
  harness.fetch.mockImplementation((url: any) =>
    held && String(url).includes(path)
      ? new Promise((resolve) => pending.push(() => resolve(v1Response())))
      : Promise.resolve(routeByUrl(url))
  )
  return {
    release: () => {
      held = false
      pending.splice(0).forEach((resolve) => resolve())
    },
  }
}

// Analytics and AI events have separate lanes: a slow or failing lane must never delay,
// drop or resend the other lane's events.
describe('capture lane isolation (Node SDK)', () => {
  const harness = new V1WiringHarness()

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    harness.useDefaultRouting()
  })

  afterEach(async () => {
    harness.useDefaultRouting()
    await harness.cleanup()
    vi.clearAllMocks()
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

  it('keeps sending analytics events on their own timer while an AI send is stuck', async () => {
    const ai = holdLane(harness, AI_CAPTURE_PATH)
    const posthog = harness.makeClient({ flushInterval: 1000, flushAt: 100, requestTimeout: 60_000 })

    posthog.captureAi({ distinctId: 'u', event: '$ai_generation', properties: {} })
    posthog.capture({ distinctId: 'u', event: 'first', properties: {} })
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.callsTo(AI_CAPTURE_PATH)).toHaveLength(1)
    expect(harness.eventsIn(ANALYTICS_CAPTURE_PATH)).toEqual(['first'])

    posthog.capture({ distinctId: 'u', event: 'second', properties: {} })
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.eventsIn(ANALYTICS_CAPTURE_PATH)).toEqual(['first', 'second'])
    expect(harness.callsTo(AI_CAPTURE_PATH)).toHaveLength(1)

    ai.release()
  })

  it('resolves flush() only after both lanes settle, without rejecting on a delivery failure', async () => {
    const ai = holdLane(harness, AI_CAPTURE_PATH)
    const holdAi = harness.fetch.getMockImplementation()!
    harness.fetch.mockImplementation((url: any, options: any) =>
      String(url).includes(ANALYTICS_CAPTURE_PATH) ? Promise.resolve(errorResponse(400)) : holdAi(url, options)
    )
    const posthog = harness.makeClient()
    const errors: CaptureError[] = []
    posthog.on('error', (error) => errors.push(error))

    posthog.capture({ distinctId: 'u', event: 'rejected', properties: {} })
    posthog.captureAi({ distinctId: 'u', event: '$ai_generation', properties: {} })
    let settled = false
    const flush = posthog.flush().then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(0)

    expect(harness.callsTo(ANALYTICS_CAPTURE_PATH)).toHaveLength(1)
    expect(errors.map((error) => error.endpoint)).toEqual([ANALYTICS_CAPTURE_PATH])
    expect(settled).toBe(false)

    ai.release()
    await expect(flush).resolves.toBe(true)
  })

  it('never drops analytics events when the AI queue is full', async () => {
    const ai = holdLane(harness, AI_CAPTURE_PATH)
    const posthog = harness.makeClient({ flushAt: 1, requestTimeout: 60_000 })
    const errors: CaptureError[] = []
    posthog.on('error', (error) => errors.push(error))

    // One AI event goes in flight; the AI queue then holds 1000 and drops the 5 oldest.
    posthog.captureAi({ distinctId: 'u', event: '$ai_0', properties: {} })
    await vi.advanceTimersByTimeAsync(0)
    for (let i = 1; i <= 1005; i++) {
      posthog.captureAi({ distinctId: 'u', event: `$ai_${i}`, properties: {} })
    }
    const analytics = ['a1', 'a2', 'a3']
    analytics.forEach((event) => posthog.capture({ distinctId: 'u', event, properties: {} }))
    await vi.advanceTimersByTimeAsync(0)
    ai.release()
    await posthog.flush()

    expect(harness.eventsIn(ANALYTICS_CAPTURE_PATH)).toEqual(analytics)
    const aiEvents = harness.eventsIn(AI_CAPTURE_PATH)
    expect(aiEvents).toHaveLength(1001)
    expect(aiEvents.slice(0, 2)).toEqual(['$ai_0', '$ai_6'])
    expect(errors).toHaveLength(1)
    expect(errors[0].endpoint).toBe(AI_CAPTURE_PATH)
    expect(errors[0].message).toContain('5 because the queue was full (1000 events)')
  })

  it('drains both lanes concurrently on shutdown and stops retrying at the deadline', async () => {
    harness.fetch.mockImplementation(() => Promise.resolve(errorResponse(503)))
    const posthog = harness.makeClient({ fetchRetryCount: 5, fetchRetryDelay: 1000, flushAt: 100 })
    const errors: CaptureError[] = []
    posthog.on('error', (error) => errors.push(error))
    posthog.capture({ distinctId: 'u', event: 'custom', properties: {}, uuid: ANALYTICS_UUID })
    const aiUuid = posthog.captureAi({ distinctId: 'u', event: '$ai_generation', properties: {} })
    await vi.advanceTimersByTimeAsync(0)

    let finished = false
    const shutdown = posthog.shutdown(1500).then(() => (finished = true))
    await vi.advanceTimersByTimeAsync(0)
    // Both first attempts go out before either lane's backoff elapses.
    expect(harness.callsTo(ANALYTICS_CAPTURE_PATH)).toHaveLength(1)
    expect(harness.callsTo(AI_CAPTURE_PATH)).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1499)
    expect(finished).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await shutdown

    expect(harness.callsTo(ANALYTICS_CAPTURE_PATH)).toHaveLength(2)
    expect(harness.callsTo(AI_CAPTURE_PATH)).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(harness.fetch).toHaveBeenCalledTimes(4)
    expect(errors).toHaveLength(2)
    expect(errors.map((error) => [error.endpoint, error.retryExhausted])).toEqual(
      expect.arrayContaining([
        [ANALYTICS_CAPTURE_PATH, [ANALYTICS_UUID]],
        [AI_CAPTURE_PATH, [aiUuid]],
      ])
    )
  })

  it('keeps events after a network failure and resends them, same uuid, on the next flush', async () => {
    harness.fetch.mockImplementation((url: any) =>
      String(url).includes(AI_CAPTURE_PATH) ? Promise.reject(new Error('network down')) : Promise.resolve(v1Response())
    )
    const posthog = harness.makeClient()
    const errors: Error[] = []
    posthog.on('error', (error) => errors.push(error))
    posthog.capture({ distinctId: 'u', event: 'custom', properties: { x: 1 } })
    const uuid = posthog.captureAi({ distinctId: 'u', event: '$ai_generation', properties: {} })
    await posthog.flush()

    expect(harness.eventsIn(ANALYTICS_CAPTURE_PATH)).toEqual(['custom'])
    expect(harness.callsTo(AI_CAPTURE_PATH)).toHaveLength(1)
    expect(errors).toEqual([])

    harness.useDefaultRouting()
    await posthog.flush()

    const [failed, resent] = captureEvents(harness.fetch, AI_CAPTURE_PATH)
    expect(resent).toEqual(failed)
    expect(resent.uuid).toBe(uuid)
    expect(harness.eventsIn(ANALYTICS_CAPTURE_PATH)).toEqual(['custom'])
    expect(errors).toEqual([])
  })

  it('drops and reports a batch whose retries end on HTTP 500, without resending it', async () => {
    harness.fetch.mockImplementation((url: any) =>
      Promise.resolve(String(url).includes(AI_CAPTURE_PATH) ? errorResponse(500) : routeByUrl(url))
    )
    const posthog = harness.makeClient({ fetchRetryCount: 1, fetchRetryDelay: 1 })
    const errors: CaptureError[] = []
    posthog.on('error', (error) => errors.push(error))
    const uuid = posthog.captureAi({ distinctId: 'u', event: '$ai_generation', properties: {} })
    const flush = posthog.flush()
    await vi.advanceTimersByTimeAsync(1)
    await flush

    expect(harness.callsTo(AI_CAPTURE_PATH)).toHaveLength(2)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ endpoint: AI_CAPTURE_PATH, retryExhausted: [uuid] })

    harness.useDefaultRouting()
    await posthog.flush()
    expect(harness.callsTo(AI_CAPTURE_PATH)).toHaveLength(2)
  })

  it("emits 'flush' once per lane with that lane's messages", async () => {
    const posthog = harness.makeClient()
    const flushed: string[][] = []
    posthog.on('flush', (messages: any[]) => flushed.push(messages.map((message) => message.event)))
    posthog.capture({ distinctId: 'u', event: 'custom', properties: {} })
    posthog.captureAi({ distinctId: 'u', event: '$ai_generation', properties: {} })
    await posthog.flush()

    expect(flushed).toHaveLength(2)
    expect(flushed).toEqual(expect.arrayContaining([['custom'], ['$ai_generation']]))
  })

  it('still sends events captured after a shutdown that hit its deadline', async () => {
    const analytics = holdLane(harness, ANALYTICS_CAPTURE_PATH)
    const posthog: PostHog = harness.makeClient({ requestTimeout: 60_000 })
    posthog.capture({ distinctId: 'u', event: 'before-shutdown', properties: {} })
    const shutdown = posthog.shutdown(100)
    await vi.advanceTimersByTimeAsync(100)
    await shutdown
    analytics.release()

    posthog.capture({ distinctId: 'u', event: 'after-shutdown', properties: {} })
    posthog.captureAi({ distinctId: 'u', event: '$ai_after_shutdown', properties: {} })
    await posthog.flush()

    expect(harness.eventsIn(ANALYTICS_CAPTURE_PATH)).toEqual(['before-shutdown', 'after-shutdown'])
    expect(harness.eventsIn(AI_CAPTURE_PATH)).toEqual(['$ai_after_shutdown'])
  })
})
