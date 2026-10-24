import { CaptureError, PostHog } from '@/entrypoints/index.node'

import { AI_CAPTURE_PATH, AI_CAPTURE_URL, ANALYTICS_CAPTURE_PATH, v1Response, v413Response } from '../utils'
import { V1WiringHarness, routeByUrl } from '../utils/v1-wiring'

vi.mock('../../version', () => ({ version: '1.2.3' }))

describe('AI capture lane wiring (Node SDK)', () => {
  const harness = new V1WiringHarness()

  const deliveredEventsIn = async (fragment: string): Promise<string[]> => {
    const events: string[] = []
    for (const [call, result] of harness.fetch.mock.calls.map(
      (call, i) => [call, harness.fetch.mock.results[i]] as const
    )) {
      if (!(call[0] as string).includes(fragment)) {
        continue
      }
      const response = await result.value
      if (response.status >= 200 && response.status < 300) {
        events.push(...JSON.parse(call[1].body).batch.map((event: any) => event.event))
      }
    }
    return events
  }

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    harness.useDefaultRouting()
  })

  afterEach(async () => {
    await harness.cleanup()
    vi.clearAllMocks()
  })

  it('captureAi posts to the AI endpoint with v1 headers and the v1 body shape', async () => {
    const posthog = harness.makeClient()
    const uuid = posthog.captureAi({
      distinctId: 'user-42',
      event: '$ai_generation',
      timestamp: new Date('2026-01-02T03:04:05.678Z'),
      properties: { $ai_model: 'gpt-4o-mini', $ai_trace_id: 'trace-1', $session_id: 'session-1' },
    })
    await posthog.flush()

    const calls = harness.callsTo(AI_CAPTURE_PATH)
    expect(calls).toHaveLength(1)
    const [url, options] = calls[0]
    expect(url).toBe(AI_CAPTURE_URL)
    expect(options.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer TEST_API_KEY',
      'PostHog-Sdk-Info': 'posthog-node/1.2.3',
      'PostHog-Attempt': '1',
    })
    const body = JSON.parse(options.body)
    expect(Object.keys(body).sort()).toEqual(['batch', 'created_at'])
    expect(body.batch).toEqual([
      {
        event: '$ai_generation',
        uuid,
        distinct_id: 'user-42',
        timestamp: '2026-01-02T03:04:05.678Z',
        session_id: 'session-1',
        options: {},
        properties: expect.objectContaining({ $ai_model: 'gpt-4o-mini', $ai_trace_id: 'trace-1' }),
      },
    ])
    expect(body.batch[0].properties).not.toHaveProperty('$lib')
    expect(harness.callsTo(ANALYTICS_CAPTURE_PATH)).toHaveLength(0)
  })

  it('capture() is never rerouted to the AI endpoint', async () => {
    const posthog = harness.makeClient()
    posthog.capture({ distinctId: 'u', event: '$ai_generation', properties: {} })
    await posthog.flush()

    expect(harness.callsTo(AI_CAPTURE_PATH)).toHaveLength(0)
    expect(harness.eventsIn(ANALYTICS_CAPTURE_PATH)).toEqual(['$ai_generation'])
  })

  it('captureAiImmediate sends a single event only to the AI endpoint', async () => {
    const posthog = harness.makeClient()
    await posthog.captureAiImmediate({ distinctId: 'u', event: '$ai_embedding', properties: {} })
    expect(harness.eventsIn(AI_CAPTURE_PATH)).toEqual(['$ai_embedding'])
    expect(harness.fetch).toHaveBeenCalledTimes(1)
  })

  it('drops events whose properties pass 8MiB with one aggregate error, delivering the rest', async () => {
    const posthog = harness.makeClient()
    const onError = vi.fn()
    posthog.on('error', onError)
    const pad = 'x'.repeat(9 * 1024 * 1024)
    const dropped = [1, 2].map(() =>
      posthog.captureAi({ distinctId: 'u', event: '$ai_generation', properties: { pad } })
    )
    posthog.captureAi({ distinctId: 'u', event: '$ai_span', properties: {} })
    await posthog.flush()

    expect(harness.eventsIn(AI_CAPTURE_PATH)).toEqual(['$ai_span'])
    expect(onError).toHaveBeenCalledTimes(1)
    const error = onError.mock.calls[0][0] as CaptureError
    expect(error).toBeInstanceOf(CaptureError)
    expect(error.endpoint).toBe(AI_CAPTURE_PATH)
    expect(error.drops).toEqual(dropped.map((uuid) => ({ uuid, details: 'event too large' })))
    expect(error.message).toBe(
      `Dropped 2 event(s) for ${AI_CAPTURE_PATH} before sending: 2 with properties larger than 8388608 bytes`
    )
    // With a listener, the listener owns reporting.
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('warns once on the console for local drops when nothing listens for errors', async () => {
    const posthog = harness.makeClient()
    const pad = 'x'.repeat(9 * 1024 * 1024)
    posthog.captureAi({ distinctId: 'u', event: '$ai_generation', properties: { pad } })
    posthog.captureAi({ distinctId: 'u', event: '$ai_generation', properties: { pad } })
    await posthog.flush()

    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalledWith(
      `[PostHog] Dropped 2 event(s) for ${AI_CAPTURE_PATH} before sending: 2 with properties larger than 8388608 bytes`
    )
  })

  it('drops an oversized captureAiImmediate event without sending it', async () => {
    const posthog = harness.makeClient()
    const onError = vi.fn()
    posthog.on('error', onError)

    const uuid = await posthog.captureAiImmediate({
      distinctId: 'u',
      event: '$ai_generation',
      properties: { pad: 'x'.repeat(9 * 1024 * 1024) },
    })

    expect(harness.callsTo(AI_CAPTURE_PATH)).toHaveLength(0)
    expect(onError).toHaveBeenCalledTimes(1)
    expect((onError.mock.calls[0][0] as CaptureError).drops).toEqual([{ uuid, details: 'event too large' }])
  })

  it('splits multi-MB batches into byte-bounded requests', async () => {
    const posthog = harness.makeClient()
    const pad = 'x'.repeat(2 * 1024 * 1024)
    for (const event of ['$ai_a', '$ai_b', '$ai_c'] as const) {
      posthog.captureAi({ distinctId: 'u', event, properties: { pad } })
    }
    await posthog.flush()

    const calls = harness.callsTo(AI_CAPTURE_PATH)
    expect(calls).toHaveLength(2)
    expect(harness.eventsIn(AI_CAPTURE_PATH)).toEqual(['$ai_a', '$ai_b', '$ai_c'])
  })

  it('treats a 413 as terminal: one request, a CaptureError naming the AI lane, no bisection', async () => {
    const posthog = harness.makeClient({ fetchRetryCount: 3, fetchRetryDelay: 1 })
    const onError = vi.fn()
    posthog.on('error', onError)
    harness.fetch.mockImplementation((url: any) =>
      Promise.resolve(url.includes(AI_CAPTURE_PATH) ? v413Response() : routeByUrl(url))
    )

    const uuids = ['$ai_a', '$ai_b', '$ai_c'].map((event) =>
      posthog.captureAi({ distinctId: 'u', event, properties: { $ai_model: 'gpt-4o-mini' } })
    )
    await expect(posthog.flush()).resolves.not.toThrow()

    expect(harness.callsTo(AI_CAPTURE_PATH)).toHaveLength(1)
    expect(harness.eventsIn(AI_CAPTURE_PATH)).toEqual(['$ai_a', '$ai_b', '$ai_c'])
    expect(onError).toHaveBeenCalledTimes(1)
    const error = onError.mock.calls[0][0] as CaptureError
    expect(error).toBeInstanceOf(CaptureError)
    expect(error.endpoint).toBe(AI_CAPTURE_PATH)
    expect(error.retryExhausted).toEqual(uuids)
    expect((error.cause as Error).message).toContain('HTTP 413')

    harness.useDefaultRouting()
    posthog.captureAi({ distinctId: 'u', event: '$ai_next', properties: {} })
    posthog.capture({ distinctId: 'u', event: 'custom', properties: {} })
    await posthog.flush()
    expect(await deliveredEventsIn(AI_CAPTURE_PATH)).toEqual(['$ai_next'])
    expect(harness.eventsIn(ANALYTICS_CAPTURE_PATH)).toEqual(['custom'])
  })

  it('keeps the AI route inactive (and flush silent) until first use', async () => {
    const posthog = harness.makeClient()
    posthog.capture({ distinctId: 'u', event: 'custom', properties: {} })
    await posthog.flush()
    expect(harness.callsTo(AI_CAPTURE_PATH)).toHaveLength(0)

    posthog.captureAi({ distinctId: 'u', event: '$ai_generation', properties: {} })
    await posthog.shutdown()
    expect(harness.eventsIn(AI_CAPTURE_PATH)).toEqual(['$ai_generation'])
  })

  it('routes non-$ai_ events through the lane anyway, with a debug log', async () => {
    const posthog = harness.makeClient()
    posthog.debug(true)
    posthog.captureAi({ distinctId: 'u', event: 'custom_event', properties: {} })
    await posthog.flush()
    expect(harness.eventsIn(AI_CAPTURE_PATH)).toEqual(['custom_event'])
    const debugLog = (console.debug as vi.Mock).mock.calls.flat().join(' ')
    expect(debugLog).toContain('custom_event')
  })

  it.each(['enableFullAiCapture', 'privacyMode'] as const)(
    'exposes %s as a readonly field, default false',
    (option) => {
      expect(harness.makeClient()[option]).toBe(false)
      expect(harness.makeClient({ [option]: true })[option]).toBe(true)
    }
  )

  it('captureAi returns the event uuid and stamps it on the wire event', async () => {
    const posthog = harness.makeClient()
    const uuid = posthog.captureAi({ distinctId: 'u', event: '$ai_generation' })
    await posthog.flush()
    const body = JSON.parse(harness.callsTo(AI_CAPTURE_PATH)[0][1].body)
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(body.batch[0].uuid).toBe(uuid)
  })

  it('captureAi keeps a caller-supplied uuid', async () => {
    const posthog = harness.makeClient()
    const supplied = '0198c0de-0000-7000-8000-000000000abc'
    expect(posthog.captureAi({ distinctId: 'u', event: '$ai_generation', uuid: supplied })).toBe(supplied)
    await posthog.flush()
    const calls = harness.callsTo(AI_CAPTURE_PATH)
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0][1].body).batch[0].uuid).toBe(supplied)
  })

  it('captureAi returns undefined when the client is disabled', () => {
    const posthog = harness.makeClient({ disabled: true })
    expect(posthog.captureAi({ distinctId: 'u', event: '$ai_generation' })).toBeUndefined()
  })

  it('captureAiImmediate resolves with the uuid after the send completes', async () => {
    const posthog = harness.makeClient()
    let startFetch!: () => void
    const started = new Promise<void>((resolve) => {
      startFetch = resolve
    })
    let completeFetch!: (response: ReturnType<typeof v1Response>) => void
    const response = new Promise<ReturnType<typeof v1Response>>((resolve) => {
      completeFetch = resolve
    })
    harness.fetch.mockImplementation(() => {
      startFetch()
      return response
    })
    const settled = vi.fn()
    const capture = posthog.captureAiImmediate({ distinctId: 'u', event: '$ai_generation' })
    void capture.then(settled)
    try {
      await started
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).not.toHaveBeenCalled()
    } finally {
      completeFetch(v1Response())
      await capture
    }
    const uuid = await capture
    expect(settled).toHaveBeenCalledWith(uuid)
    const calls = harness.callsTo(AI_CAPTURE_PATH)
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0][1].body).batch[0].uuid).toBe(uuid)
  })
})
