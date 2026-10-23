import { PostHogTraceExporter } from '../src/otel'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'

vi.mock('@opentelemetry/exporter-trace-otlp-http', () => {
  const MockExporter = vi.fn()
  MockExporter.prototype.export = vi.fn()
  MockExporter.prototype.shutdown = vi.fn().mockResolvedValue(undefined)
  MockExporter.prototype.forceFlush = vi.fn().mockResolvedValue(undefined)
  return { OTLPTraceExporter: MockExporter }
})

const DEFAULT_TOKEN = 'phc_test'

function makeSpan(name: string, attributes: Record<string, unknown> = {}): ReadableSpan {
  return { name, attributes } as unknown as ReadableSpan
}

function getSuperExport(): vi.Mock {
  return OTLPTraceExporter.prototype.export as vi.Mock
}

function getSuperShutdown(): vi.Mock {
  return OTLPTraceExporter.prototype.shutdown as vi.Mock
}

function getSuperForceFlush(): vi.Mock {
  return OTLPTraceExporter.prototype.forceFlush as vi.Mock
}

describe('PostHogTraceExporter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    {
      name: 'default host',
      projectToken: 'phc_test123',
      host: undefined,
      expectedUrl: 'https://us.i.posthog.com/i/v0/ai/otel',
      expectedToken: 'phc_test123',
    },
    {
      name: 'custom host',
      projectToken: 'phc_test456',
      host: 'https://eu.i.posthog.com',
      expectedUrl: 'https://eu.i.posthog.com/i/v0/ai/otel',
      expectedToken: 'phc_test456',
    },
    {
      name: 'trailing slash',
      projectToken: 'phc_test789',
      host: 'https://custom.posthog.com/',
      expectedUrl: 'https://custom.posthog.com/i/v0/ai/otel',
      expectedToken: 'phc_test789',
    },
    {
      name: 'multiple trailing slashes',
      projectToken: 'phc_test000',
      host: 'https://custom.posthog.com///',
      expectedUrl: 'https://custom.posthog.com/i/v0/ai/otel',
      expectedToken: 'phc_test000',
    },
    {
      name: 'trimmed whitespace-sensitive values',
      projectToken: '  phc_test999\t ',
      host: '  https://custom.posthog.com/\n',
      expectedUrl: 'https://custom.posthog.com/i/v0/ai/otel',
      expectedToken: 'phc_test999',
    },
  ])('configures the OTLP exporter correctly with $name', ({ projectToken, host, expectedUrl, expectedToken }) => {
    new PostHogTraceExporter({ projectToken, host })

    expect(OTLPTraceExporter).toHaveBeenCalledWith({
      url: expectedUrl,
      headers: {
        Authorization: `Bearer ${expectedToken}`,
      },
    })
  })

  it.each([
    ['missing', {}],
    ['empty', { projectToken: '' }],
    ['blank', { projectToken: '  \n\t ' }],
  ])('disables and no-ops when projectToken is %s', (_case, options) => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const exporter = new PostHogTraceExporter(options as any)
    const callback = vi.fn()

    exporter.export([makeSpan('gen_ai.chat')], callback)

    expect(getSuperExport()).not.toHaveBeenCalled()
    expect(callback).toHaveBeenCalledWith({ code: 0 })
    expect(warnSpy).toHaveBeenCalledWith(
      '[PostHogTraceExporter] projectToken is missing or blank; the exporter will be disabled.'
    )
    warnSpy.mockRestore()
  })

  it('does not validate host when disabled by missing projectToken', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() => new PostHogTraceExporter({ projectToken: '', host: 'not a url' })).not.toThrow()

    expect(warnSpy).toHaveBeenCalledWith(
      '[PostHogTraceExporter] projectToken is missing or blank; the exporter will be disabled.'
    )
    warnSpy.mockRestore()
  })

  it('inherits shutdown from OTLPTraceExporter', async () => {
    const exporter = new PostHogTraceExporter({ projectToken: DEFAULT_TOKEN })
    await exporter.shutdown()
    expect(getSuperShutdown()).toHaveBeenCalled()
  })

  it('inherits forceFlush from OTLPTraceExporter', async () => {
    const exporter = new PostHogTraceExporter({ projectToken: DEFAULT_TOKEN })
    await exporter.forceFlush()
    expect(getSuperForceFlush()).toHaveBeenCalled()
  })
})

describe('PostHogTraceExporter AI span filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exports only AI spans', () => {
    const exporter = new PostHogTraceExporter({ projectToken: DEFAULT_TOKEN })
    const callback = vi.fn()

    exporter.export([makeSpan('gen_ai.chat'), makeSpan('http.request'), makeSpan('llm.completion')], callback)

    expect(getSuperExport()).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'gen_ai.chat' }), expect.objectContaining({ name: 'llm.completion' })],
      callback
    )
  })

  it('calls back with success immediately when no AI spans are present', () => {
    const exporter = new PostHogTraceExporter({ projectToken: DEFAULT_TOKEN })
    const callback = vi.fn()

    exporter.export([makeSpan('http.request'), makeSpan('db.query')], callback)

    expect(getSuperExport()).not.toHaveBeenCalled()
    expect(callback).toHaveBeenCalledWith({ code: 0 })
  })

  it('detects AI spans by attribute keys', () => {
    const exporter = new PostHogTraceExporter({ projectToken: DEFAULT_TOKEN })
    const callback = vi.fn()

    exporter.export([makeSpan('some.operation', { 'gen_ai.model': 'gpt-4' }), makeSpan('other.operation')], callback)

    expect(getSuperExport()).toHaveBeenCalledWith([expect.objectContaining({ name: 'some.operation' })], callback)
  })

  it('redacts multimodal content before exporting', () => {
    const exporter = new PostHogTraceExporter({ projectToken: DEFAULT_TOKEN })
    const callback = vi.fn()

    exporter.export([makeSpan('gen_ai.chat', { 'gen_ai.prompt': 'data:image/png;base64,iVBORw0KGgo' })], callback)

    const exported = getSuperExport().mock.calls[0][0] as ReadableSpan[]
    expect(exported[0].attributes['gen_ai.prompt']).toBe('[base64 image/png redacted]')
  })

  it.each([
    ['drops', true],
    ['keeps', false],
  ])('%s content attributes when privacyMode is %s', (_verb, privacyMode) => {
    const exporter = new PostHogTraceExporter({ projectToken: DEFAULT_TOKEN, privacyMode })
    const content = {
      'ai.prompt': 'CANARY_7f3a',
      'ai.response.toolCalls': 'CANARY_7f3a',
      'ai.toolCall.args': 'CANARY_7f3a',
      'gen_ai.output.messages': 'CANARY_7f3a',
      'gen_ai.system_instructions': 'CANARY_7f3a',
      'gen_ai.completion.0.content': 'CANARY_7f3a',
      'llm.input_messages.0.message.content': 'CANARY_7f3a',
      'llm.choices.0.completion.text': 'CANARY_7f3a',
      'llm.function_call': 'CANARY_7f3a',
      'llm.prompt_template.variables': 'CANARY_7f3a',
      'llm.invocation_parameters': 'CANARY_7f3a',
      'embedding.embeddings.0.embedding.text': 'CANARY_7f3a',
      'traceloop.entity.input': 'CANARY_7f3a',
      'exception.message': 'CANARY_7f3a',
    }
    const providerMetadata = JSON.stringify({
      gateway: { cost: '0.0012' },
      google: { groundingMetadata: { webSearchQueries: ['CANARY_7f3a'] } },
    })

    exporter.export(
      [
        makeSpan('ai.streamText.doStream', {
          ...content,
          'ai.response.providerMetadata': providerMetadata,
          'gen_ai.usage.output_tokens': 7,
        }),
      ],
      vi.fn()
    )

    const exported = getSuperExport().mock.calls[0][0] as ReadableSpan[]
    expect(exported[0].attributes).toEqual(
      privacyMode
        ? {
            'ai.response.providerMetadata': JSON.stringify({ gateway: { cost: '0.0012' } }),
            'gen_ai.usage.output_tokens': 7,
          }
        : { ...content, 'ai.response.providerMetadata': providerMetadata, 'gen_ai.usage.output_tokens': 7 }
    )
  })
})
