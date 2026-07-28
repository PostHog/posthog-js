import { PostHogPersistedProperty } from '@posthog/core'

import { PostHog } from '@/entrypoints/index.node'

import { V1WiringHarness, v413Response, v0Response, waitForFlushTimer } from '../utils/v1-wiring'

jest.mock('../../version', () => ({ version: '1.2.3' }))

describe('AI capture lane wiring (Node SDK)', () => {
  const harness = new V1WiringHarness()

  const aiCaptureQueueEvents = (posthog: PostHog): string[] =>
    (posthog.getPersistedProperty(PostHogPersistedProperty.AiCaptureQueue) || []).map((item: any) => item.message.event)

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
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'info').mockImplementation(() => {})
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'debug').mockImplementation(() => {})
    harness.useDefaultRouting()
  })

  afterEach(async () => {
    await harness.cleanup()
    jest.clearAllMocks()
  })

  it('_captureAi posts to the AI endpoint with the V0 body shape', async () => {
    const posthog = harness.makeClient()
    posthog._captureAi({ distinctId: 'u', event: '$ai_generation', properties: { $ai_model: 'gpt' } })
    await posthog.flush()

    const calls = harness.callsTo('/i/v0/ai/batch/')
    expect(calls).toHaveLength(1)
    const body = JSON.parse(calls[0][1].body)
    expect(Object.keys(body).sort()).toEqual(['api_key', 'batch', 'sent_at'])
    expect(body.batch.map((event: any) => event.event)).toEqual(['$ai_generation'])
    expect(harness.callsTo('example.com/batch/')).toHaveLength(0)
  })

  it('capture() is never rerouted to the AI endpoint, in either capture mode', async () => {
    for (const mode of ['v0', 'v1'] as const) {
      const posthog = harness.makeClient({}, mode)
      posthog.capture({ distinctId: 'u', event: '$ai_generation', properties: {} })
      await posthog.flush()
    }
    expect(harness.callsTo('/i/v0/ai/batch/')).toHaveLength(0)
    expect(harness.eventsIn('example.com/batch/')).toEqual(['$ai_generation', '$ai_generation'])
  })

  it('_captureAi stays on the AI endpoint in v1 mode, isolated from both other routes', async () => {
    const posthog = harness.makeClient({}, 'v1')
    posthog.capture({ distinctId: 'u', event: 'custom', properties: {} })
    posthog.capture({ distinctId: 'u', event: '$ai_generation', properties: {} })
    posthog._captureAi({ distinctId: 'u', event: '$ai_span', properties: {} })
    await waitForFlushTimer()
    await posthog.flush()

    expect(harness.eventsIn('/i/v1/analytics/events')).toEqual(['custom'])
    expect(harness.eventsIn('example.com/batch/')).toEqual(['$ai_generation'])
    expect(harness.eventsIn('/i/v0/ai/batch/')).toEqual(['$ai_span'])
  })

  it('_captureAiImmediate awaits a single AI endpoint delivery', async () => {
    const posthog = harness.makeClient()
    await posthog._captureAiImmediate({ distinctId: 'u', event: '$ai_embedding', properties: {} })
    expect(harness.eventsIn('/i/v0/ai/batch/')).toEqual(['$ai_embedding'])
  })

  it('drops events over 8MiB with a name-and-size-only error log, delivering the rest', async () => {
    const posthog = harness.makeClient()
    posthog.debug(true)
    const pad = 'x'.repeat(9 * 1024 * 1024)
    posthog._captureAi({ distinctId: 'u', event: '$ai_generation', properties: { pad } })
    posthog._captureAi({ distinctId: 'u', event: '$ai_span', properties: {} })
    await posthog.flush()

    expect(harness.eventsIn('/i/v0/ai/batch/')).toEqual(['$ai_span'])
    const errorLog = (console.error as jest.Mock).mock.calls.flat().join(' ')
    expect(errorLog).toContain('$ai_generation')
    expect(errorLog).toMatch(/\d+ bytes/)
    expect(errorLog).not.toContain('xxxx')
  })

  it('splits multi-MB batches into byte-bounded requests', async () => {
    const posthog = harness.makeClient()
    const pad = 'x'.repeat(2 * 1024 * 1024)
    for (const event of ['$ai_a', '$ai_b', '$ai_c'] as const) {
      posthog._captureAi({ distinctId: 'u', event, properties: { pad } })
    }
    await posthog.flush()

    const calls = harness.callsTo('/i/v0/ai/batch/')
    expect(calls).toHaveLength(2)
    expect(harness.eventsIn('/i/v0/ai/batch/')).toEqual(['$ai_a', '$ai_b', '$ai_c'])
  })

  it('bisects a sub-batch in-lane on 413 without tripping the shared batch-size halving', async () => {
    const posthog = harness.makeClient()
    harness.fetch.mockImplementationOnce(() => Promise.resolve(v413Response()))
    harness.fetch.mockImplementation(() => Promise.resolve(v0Response()))

    for (const event of ['$ai_a', '$ai_b', '$ai_c'] as const) {
      posthog._captureAi({ distinctId: 'u', event, properties: {} })
    }
    await expect(posthog.flush()).resolves.not.toThrow()

    expect((await deliveredEventsIn('/i/v0/ai/batch/')).sort()).toEqual(['$ai_a', '$ai_b', '$ai_c'])
    expect(harness.callsTo('/i/v0/ai/batch/').length).toBeGreaterThan(1)

    harness.useDefaultRouting()
    for (const event of ['custom_1', 'custom_2', 'custom_3'] as const) {
      posthog.capture({ distinctId: 'u', event, properties: {} })
    }
    await posthog.flush()

    const analyticsCalls = harness.callsTo('example.com/batch/')
    expect(analyticsCalls).toHaveLength(1)
    expect(JSON.parse(analyticsCalls[0][1].body).batch.map((e: any) => e.event)).toEqual([
      'custom_1',
      'custom_2',
      'custom_3',
    ])
  })

  it('drops a single event that still 413s alone, without throwing, and keeps the lane usable', async () => {
    const posthog = harness.makeClient()
    posthog.debug(true)
    harness.fetch.mockImplementation((url: any) =>
      Promise.resolve(url.includes('/i/v0/ai/batch/') ? v413Response() : v0Response())
    )

    posthog._captureAi({ distinctId: 'u', event: '$ai_undeliverable', properties: {} })
    await expect(posthog.flush()).resolves.not.toThrow()

    expect(await deliveredEventsIn('/i/v0/ai/batch/')).toEqual([])
    const errorLog = (console.error as jest.Mock).mock.calls.flat().join(' ')
    expect(errorLog).toContain('$ai_undeliverable')
    expect(errorLog).toMatch(/\d+ bytes/)

    harness.useDefaultRouting()
    posthog._captureAi({ distinctId: 'u', event: '$ai_next', properties: {} })
    await posthog.flush()
    expect(await deliveredEventsIn('/i/v0/ai/batch/')).toEqual(['$ai_next'])
  })

  it('keeps the AI route inactive (and flush silent) until first use', async () => {
    const posthog = harness.makeClient()
    posthog.capture({ distinctId: 'u', event: 'custom', properties: {} })
    await posthog.flush()
    expect(harness.callsTo('/i/v0/ai/batch/')).toHaveLength(0)

    posthog._captureAi({ distinctId: 'u', event: '$ai_generation', properties: {} })
    await posthog.shutdown()
    expect(harness.eventsIn('/i/v0/ai/batch/')).toEqual(['$ai_generation'])
    expect(aiCaptureQueueEvents(posthog)).toEqual([])
  })

  it('routes non-$ai_ events through the lane anyway, with a debug log', async () => {
    const posthog = harness.makeClient()
    posthog.debug(true)
    posthog._captureAi({ distinctId: 'u', event: 'custom_event', properties: {} })
    await posthog.flush()
    expect(harness.eventsIn('/i/v0/ai/batch/')).toEqual(['custom_event'])
    const debugLog = (console.debug as jest.Mock).mock.calls.flat().join(' ')
    expect(debugLog).toContain('custom_event')
  })

  it('exposes the internal option flags as readonly fields', () => {
    const defaults = harness.makeClient()
    expect(defaults._useAiLane).toBe(false)
    expect(defaults._enableMultimodalCapture).toBe(false)

    const optedIn = harness.makeClient({ _useAiLane: true })
    expect(optedIn._useAiLane).toBe(true)

    const multimodal = harness.makeClient({ _enableMultimodalCapture: true })
    expect(multimodal._enableMultimodalCapture).toBe(true)
    expect(multimodal._useAiLane).toBe(true)
  })
})
