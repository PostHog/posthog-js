import { PostHogTraceExporter } from '../src/otel'
import { OtlpFetchTraceExporter } from '../src/otel/otlpFetchExporter'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'

vi.mock('../src/otel/otlpFetchExporter', () => {
  const MockExporter = vi.fn()
  MockExporter.prototype.export = vi.fn()
  MockExporter.prototype.shutdown = vi.fn().mockResolvedValue(undefined)
  MockExporter.prototype.forceFlush = vi.fn().mockResolvedValue(undefined)
  return { OtlpFetchTraceExporter: MockExporter, EXPORT_SUCCESS: 0, EXPORT_FAILED: 1 }
})

const DEFAULT_TOKEN = 'phc_test'

function makeSpan(name: string, attributes: Record<string, unknown> = {}): ReadableSpan {
  return { name, attributes } as unknown as ReadableSpan
}

function getInnerExport(): vi.Mock {
  return OtlpFetchTraceExporter.prototype.export as vi.Mock
}

function getInnerShutdown(): vi.Mock {
  return OtlpFetchTraceExporter.prototype.shutdown as vi.Mock
}

function getInnerForceFlush(): vi.Mock {
  return OtlpFetchTraceExporter.prototype.forceFlush as vi.Mock
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

    expect(OtlpFetchTraceExporter).toHaveBeenCalledWith({
      url: expectedUrl,
      headers: { Authorization: `Bearer ${expectedToken}` },
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

    expect(getInnerExport()).not.toHaveBeenCalled()
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

  it('delegates shutdown to the fetch exporter', async () => {
    const exporter = new PostHogTraceExporter({ projectToken: DEFAULT_TOKEN })
    await exporter.shutdown()
    expect(getInnerShutdown()).toHaveBeenCalled()
  })

  it('delegates forceFlush to the fetch exporter', async () => {
    const exporter = new PostHogTraceExporter({ projectToken: DEFAULT_TOKEN })
    await exporter.forceFlush()
    expect(getInnerForceFlush()).toHaveBeenCalled()
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

    expect(getInnerExport()).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'gen_ai.chat' }), expect.objectContaining({ name: 'llm.completion' })],
      callback
    )
  })

  it('calls back with success immediately when no AI spans are present', () => {
    const exporter = new PostHogTraceExporter({ projectToken: DEFAULT_TOKEN })
    const callback = vi.fn()

    exporter.export([makeSpan('http.request'), makeSpan('db.query')], callback)

    expect(getInnerExport()).not.toHaveBeenCalled()
    expect(callback).toHaveBeenCalledWith({ code: 0 })
  })

  it('detects AI spans by attribute keys', () => {
    const exporter = new PostHogTraceExporter({ projectToken: DEFAULT_TOKEN })
    const callback = vi.fn()

    exporter.export([makeSpan('some.operation', { 'gen_ai.model': 'gpt-4' }), makeSpan('other.operation')], callback)

    expect(getInnerExport()).toHaveBeenCalledWith([expect.objectContaining({ name: 'some.operation' })], callback)
  })

  it('redacts multimodal content before exporting', () => {
    const exporter = new PostHogTraceExporter({ projectToken: DEFAULT_TOKEN })
    const callback = vi.fn()

    exporter.export([makeSpan('gen_ai.chat', { 'gen_ai.prompt': 'data:image/png;base64,iVBORw0KGgo' })], callback)

    const exported = getInnerExport().mock.calls[0][0] as ReadableSpan[]
    expect(exported[0].attributes['gen_ai.prompt']).toBe('[base64 image/png redacted]')
  })
})
