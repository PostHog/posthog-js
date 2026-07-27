import { PostHogPersistedProperty } from '@posthog/core'

import { PostHog } from '@/entrypoints/index.node'

import { V1WiringHarness, waitForFlushTimer } from '../utils/v1-wiring'

jest.mock('../../version', () => ({ version: '1.2.3' }))

describe('AI capture lane wiring (Node SDK)', () => {
  const harness = new V1WiringHarness()

  const aiCaptureQueueEvents = (posthog: PostHog): string[] =>
    (posthog.getPersistedProperty(PostHogPersistedProperty.AiCaptureQueue) || []).map((item: any) => item.message.event)

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

  it('routes non-$ai_ events through the lane anyway, with an info log', async () => {
    const posthog = harness.makeClient()
    posthog._captureAi({ distinctId: 'u', event: 'custom_event', properties: {} })
    await posthog.flush()
    expect(harness.eventsIn('/i/v0/ai/batch/')).toEqual(['custom_event'])
  })

  it('exposes the internal option flags as readonly fields', () => {
    const defaults = harness.makeClient()
    expect(defaults._useAiLane).toBe(false)
    expect(defaults._enableMultimodalCapture).toBe(false)

    const optedIn = harness.makeClient({ _useAiLane: true })
    expect(optedIn._useAiLane).toBe(true)

    const multimodal = harness.makeClient({ _enableMultimodalCapture: true })
    expect(multimodal._enableMultimodalCapture).toBe(true)
  })
})
