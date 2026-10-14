import { BasicTracerProvider, type ReadableSpan, type SpanProcessor } from '@opentelemetry/sdk-trace-base'
import type { Attributes } from '@opentelemetry/api'
import { PostHog } from 'posthog-node'

import { PostHogSpanProcessor, type PostHogContextSource } from '../src/otel'

describe('PostHogSpanProcessor request context', () => {
  let posthog: PostHog
  let ended: ReadableSpan[]

  function recorder(sink: ReadableSpan[] = ended): SpanProcessor {
    return {
      onStart: () => undefined,
      onEnd: (span) => {
        sink.push(span)
      },
      shutdown: () => Promise.resolve(),
      forceFlush: () => Promise.resolve(),
    }
  }

  function providerWith(processor: PostHogSpanProcessor): BasicTracerProvider {
    return new BasicTracerProvider({ spanProcessors: [processor] })
  }

  function providerWithClient(client: PostHogContextSource = posthog): BasicTracerProvider {
    return providerWith(new PostHogSpanProcessor({ projectToken: 'phc_test', client, _spanProcessor: recorder() }))
  }

  function emitAISpan(provider: BasicTracerProvider, attributes: Attributes = {}): void {
    provider.getTracer('test').startSpan('gen_ai.chat', { attributes }).end()
  }

  beforeEach(() => {
    ended = []
    posthog = new PostHog('phc_test', { host: 'http://127.0.0.1:9', flushAt: 1000, flushInterval: 0 })
  })

  afterEach(async () => {
    await posthog.shutdown()
  })

  it('stamps distinct ID, session ID and properties from the client context', () => {
    const provider = providerWithClient()

    posthog.withContext({ distinctId: 'alice', sessionId: 's_alice', properties: { plan: 'pro' } }, () =>
      emitAISpan(provider)
    )

    expect(ended.map((span) => span.attributes)).toEqual([
      { 'posthog.distinct_id': 'alice', $session_id: 's_alice', plan: 'pro' },
    ])
  })

  it('keeps attributes already on the span', () => {
    const provider = providerWithClient()

    posthog.withContext({ sessionId: 's_alice' }, () => emitAISpan(provider, { $session_id: 'span_session' }))

    expect(ended[0].attributes.$session_id).toBe('span_session')
  })

  it('does not derive $ai_session_id from the context session', () => {
    const provider = providerWithClient()

    posthog.withContext({ sessionId: 's_alice' }, () => emitAISpan(provider))

    expect(ended[0].attributes).toEqual({ $session_id: 's_alice' })
  })

  it.each([
    'posthog.distinct_id',
    'user.id',
    'ai.telemetry.metadata.posthog_distinct_id',
    'ai.settings.context.posthog_distinct_id',
  ])('keeps the span identity when it carries %s', (key) => {
    const provider = providerWithClient()

    posthog.withContext({ distinctId: 'alice', sessionId: 's_alice' }, () => emitAISpan(provider, { [key]: 'bob' }))

    expect(ended[0].attributes).toEqual({ [key]: 'bob', $session_id: 's_alice' })
  })

  it('drops a distinct ID property when the span already has an identity', () => {
    const provider = providerWithClient()

    posthog.withContext({ properties: { 'posthog.distinct_id': 'alice' } }, () =>
      emitAISpan(provider, { 'user.id': 'bob' })
    )

    expect(ended[0].attributes).toEqual({ 'user.id': 'bob' })
  })

  it('encodes structured properties as JSON', () => {
    const provider = providerWithClient()

    posthog.withContext(
      { properties: { account: { tier: 'pro', seats: 3 }, arms: ['short-prompt', 'new-router'], mixed: ['a', 1] } },
      () => emitAISpan(provider)
    )

    const { account, arms, mixed } = ended[0].attributes
    expect(JSON.parse(String(account))).toEqual({ tier: 'pro', seats: 3 })
    expect(arms).toEqual(['short-prompt', 'new-router'])
    expect(JSON.parse(String(mixed))).toEqual(['a', 1])
  })

  it('lets properties override the context session ID', () => {
    const provider = providerWithClient()

    posthog.withContext({ sessionId: 's_alice', properties: { $session_id: 'tagged' } }, () => emitAISpan(provider))

    expect(ended[0].attributes.$session_id).toBe('tagged')
  })

  it('passes an explicit $ai_session_id property through', () => {
    const provider = providerWithClient()

    posthog.withContext({ sessionId: 's_alice', properties: { $ai_session_id: 'conv_42' } }, () => emitAISpan(provider))

    expect(ended[0].attributes).toEqual({ $session_id: 's_alice', $ai_session_id: 'conv_42' })
  })

  it('skips an empty distinct ID and session ID', () => {
    const provider = providerWithClient()

    posthog.withContext({ distinctId: '', sessionId: '', properties: { plan: 'pro' } }, () => emitAISpan(provider))

    expect(ended[0].attributes).toEqual({ plan: 'pro' })
  })

  it('exports the span unchanged when the context has no usable values', () => {
    const provider = providerWithClient()

    posthog.withContext({ properties: { empty: '', missing: undefined } }, () =>
      emitAISpan(provider, { 'gen_ai.system': 'openai' })
    )

    expect(ended[0].attributes).toEqual({ 'gen_ai.system': 'openai' })
  })

  it('reads a context entered with enterContext', () => {
    const provider = providerWithClient()

    posthog.enterContext({ distinctId: 'alice' })
    emitAISpan(provider)

    expect(ended[0].attributes['posthog.distinct_id']).toBe('alice')
  })

  it('keeps the context off the live span and other processors', () => {
    const seenByOthers: ReadableSpan[] = []
    const provider = new BasicTracerProvider({
      spanProcessors: [
        new PostHogSpanProcessor({ projectToken: 'phc_test', client: posthog, _spanProcessor: recorder() }),
        recorder(seenByOthers),
      ],
    })

    posthog.withContext({ distinctId: 'alice', properties: { plan: 'pro' } }, () => emitAISpan(provider))

    expect(ended[0].attributes).toEqual({ 'posthog.distinct_id': 'alice', plan: 'pro' })
    expect(seenByOthers.map((span) => span.attributes)).toEqual([{}])
  })

  it('drops a non-AI span started inside a context', () => {
    const provider = providerWithClient()

    posthog.withContext({ distinctId: 'alice' }, () => provider.getTracer('test').startSpan('db.query').end())

    expect(ended).toEqual([])
  })

  it('does not throw into the caller when reading the context fails', () => {
    const failingClient: PostHogContextSource = {
      getContext: () => {
        throw new Error('context unavailable')
      },
    }
    const provider = providerWithClient(failingClient)

    expect(() => emitAISpan(provider)).not.toThrow()
    expect(ended).toHaveLength(1)
  })

  it('adds nothing outside a context or without a client', () => {
    const withClient = providerWithClient()
    const withoutClient = providerWith(
      new PostHogSpanProcessor({ projectToken: 'phc_test', _spanProcessor: recorder() })
    )

    emitAISpan(withClient)
    posthog.withContext({ distinctId: 'alice' }, () => emitAISpan(withoutClient))

    expect(ended.map((span) => span.attributes)).toEqual([{}, {}])
  })

  it('stamps each overlapping request with its own context', async () => {
    const provider = providerWithClient()
    const tracer = provider.getTracer('test')
    let startedCount = 0
    let release: () => void = () => undefined
    const bothStarted = new Promise<void>((resolve) => {
      release = resolve
    })
    const request = (distinctId: string): Promise<ReturnType<typeof tracer.startSpan>> =>
      posthog.withContext({ distinctId }, async () => {
        const span = tracer.startSpan('gen_ai.chat')
        startedCount += 1
        if (startedCount === 2) {
          release()
        }
        await bothStarted
        return span
      })

    const spans = await Promise.all([request('alice'), request('bob')])
    spans.forEach((span) => span.end())

    expect(ended.map((span) => span.attributes['posthog.distinct_id']).sort()).toEqual(['alice', 'bob'])
  })

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['an array holding NaN', [1, Number.NaN]],
    ['an array holding Infinity', [1, Number.POSITIVE_INFINITY]],
    ['a nested NaN', { score: Number.NaN }],
  ])('skips %s while keeping other properties', (_label, value) => {
    const provider = providerWithClient()

    posthog.withContext({ properties: { bad: value, plan: 'pro' } }, () => emitAISpan(provider))

    expect(ended[0].attributes).toEqual({ plan: 'pro' })
  })

  it('exports string-like values as plain strings', () => {
    const provider = providerWithClient()
    const signedUpAt = new Date('2026-01-02T03:04:05.000Z')

    const invalidDate = new Date(Number.NaN)

    posthog.withContext(
      { properties: { signedUpAt, invalidDate, label: { toJSON: () => 'tagged' }, blank: { toJSON: () => '' } } },
      () => emitAISpan(provider)
    )

    expect(ended[0].attributes).toEqual({ signedUpAt: '2026-01-02T03:04:05.000Z', label: 'tagged' })
  })

  it('exports the span unchanged when a property getter throws', () => {
    const properties = {
      get broken(): string {
        throw new Error('boom')
      },
    }
    const provider = providerWithClient({ getContext: () => ({ properties }) })

    expect(() => emitAISpan(provider)).not.toThrow()
    expect(ended).toHaveLength(1)
  })

  it('skips a value JSON.stringify rejects while keeping other properties', () => {
    const provider = providerWithClient()
    const circular: Record<string, unknown> = {}
    circular.self = circular

    posthog.withContext({ properties: { big: BigInt(1), circular, plan: 'pro' } }, () => emitAISpan(provider))

    expect(ended[0].attributes).toEqual({ plan: 'pro' })
  })

  it('exports nothing and does not throw when the token is blank', () => {
    const provider = providerWith(
      new PostHogSpanProcessor({ projectToken: '  ', client: posthog, _spanProcessor: recorder() })
    )

    expect(() => posthog.withContext({ distinctId: 'alice' }, () => emitAISpan(provider))).not.toThrow()
    expect(ended).toEqual([])
  })
})
