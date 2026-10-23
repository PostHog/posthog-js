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
  ])('%s content attributes and events when privacyMode is %s', (_verb, privacyMode) => {
    const exporter = new PostHogTraceExporter({ projectToken: DEFAULT_TOKEN, privacyMode })
    const content = Object.fromEntries(
      [
        'ai.prompt',
        'ai.response.toolCalls',
        'ai.toolCall.args',
        'ai.documents',
        'ai.request.text',
        'ai.decision.state',
        'ai.decision.questions',
        'ai.decision.answers',
        'gen_ai.output.messages',
        'gen_ai.system_instructions',
        'gen_ai.completion.0.content',
        'gen_ai.prompt.variable.city',
        'gen_ai.retrieval.documents',
        'gen_ai.retrieval.query.text',
        'gen_ai.memory.query.text',
        'gen_ai.memory.records',
        'gen_ai.evaluation.explanation',
        'gen_ai.task.input',
        'gen_ai.task.output',
        'gen_ai.guardrail.input',
        'gen_ai.guardrail.output',
        'gen_ai.guardrail.error.message',
        'gen_ai.response.revised_prompt',
        'mcp.response.value',
        'traceloop.entity.input',
        'traceloop.prompt.template',
        'traceloop.prompt.template_variables.city',
        'db.marqo.search.query',
        'db.chroma.query.where_document',
        'llm.input_messages.0.message.content',
        'llm.choices.0.completion.text',
        'llm.function_call',
        'llm.prompt_template.variables',
        'llm.invocation_parameters',
        'embedding.embeddings.0.embedding.text',
        'retrieval.documents.0.document.content',
        'retrieval.documents.0.document.metadata',
        'reranker.query',
        'reranker.input_documents.0.document.content',
        'reranker.output_documents.0.document.content',
        'input.images.0.image.url',
        'model_request_parameters',
        'inputs',
        'prompt',
        'langfuse.trace.input',
        'langfuse.trace.output',
        'langfuse.observation.input',
        'langfuse.observation.output',
        'langfuse.observation.status_message',
        'langfuse.experiment.item.expected_output',
        'mastra.agent_run.input',
        'mastra.tool_call.output',
        'exception.message',
      ].map((key) => [key, 'CANARY_7f3a'])
    )
    const functionTool = { type: 'function', name: 'lookup' }
    const mcpTool = { type: 'mcp', server_url: 'https://mcp.example.com', authorization: 'CANARY_7f3a' }
    const vercelMcpTool = {
      type: 'provider',
      id: 'openai.mcp',
      name: 'mcp',
      args: { serverUrl: 'https://mcp.example.com', headers: { Authorization: 'CANARY_7f3a' } },
    }
    const toolDefinitions = (mcp: object, vercelMcp: object): Record<string, unknown> => ({
      'gen_ai.tool.definitions': JSON.stringify([functionTool, mcp]),
      'ai.prompt.tools': [JSON.stringify(functionTool), JSON.stringify(vercelMcp)],
      'llm.tools.0.tool.json_schema': JSON.stringify(mcp),
    })
    const metadata = {
      'gen_ai.prompt.name': 'support-reply',
      'gen_ai.prompt.version': '3',
      'gen_ai.usage.output_tokens': 7,
    }
    const unparseableTool = { 'llm.tools.1.tool.json_schema': 'lookup(q: string)' }
    const tools = { ...toolDefinitions(mcpTool, vercelMcpTool), ...unparseableTool }
    const redactedTools = toolDefinitions(
      { ...mcpTool, authorization: '[REDACTED]' },
      { ...vercelMcpTool, args: { ...vercelMcpTool.args, headers: '[REDACTED]' } }
    )
    const providerMetadata = JSON.stringify({
      gateway: { cost: '0.0012' },
      google: { groundingMetadata: { webSearchQueries: ['CANARY_7f3a'] } },
    })
    const exceptionEvent = {
      name: 'exception',
      attributes: { 'exception.type': 'AI_APICallError', 'exception.message': 'CANARY_7f3a' },
      time: [0, 0],
    }
    const events = [
      exceptionEvent,
      { name: 'gen_ai.user.message', attributes: { content: 'CANARY_7f3a' }, time: [0, 0] },
      { name: 'db.query.result', attributes: { 'db.query.result.document': 'CANARY_7f3a' }, time: [0, 0] },
      { name: 'qdrant.search.result.0', attributes: { 'qdrant.search.result.0.payload': 'CANARY_7f3a' }, time: [0, 0] },
    ]

    exporter.export(
      [
        {
          ...makeSpan('ai.streamText.doStream', {
            ...content,
            ...metadata,
            ...tools,
            'ai.response.providerMetadata': providerMetadata,
          }),
          events,
        } as unknown as ReadableSpan,
      ],
      vi.fn()
    )

    const exported = getSuperExport().mock.calls[0][0] as ReadableSpan[]
    expect(exported[0].attributes).toEqual(
      privacyMode
        ? {
            ...metadata,
            ...redactedTools,
            'ai.response.providerMetadata': JSON.stringify({ gateway: { cost: '0.0012' } }),
          }
        : {
            ...content,
            ...metadata,
            ...redactedTools,
            ...unparseableTool,
            'ai.response.providerMetadata': providerMetadata,
          }
    )
    expect(exported[0].events).toEqual(
      privacyMode ? [{ ...exceptionEvent, attributes: { 'exception.type': 'AI_APICallError' } }] : events
    )
  })
})
