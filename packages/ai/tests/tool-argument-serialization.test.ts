import type { LanguageModelV2, LanguageModelV3 } from '@ai-sdk/provider'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import type { PostHog } from 'posthog-node'
import { FakeToolCallingModel } from 'langchain'
import { withTracing } from '../src/vercel'
import { LangChainCallbackHandler } from '../src/langchain/callbacks'
import { createPostHogMiddleware } from '../src/langchain/middleware'

// Provider and capture doubles exercise actual instrumentation without network access.
const serializationError = new Error('application toJSON failed')
const cases = [
  { name: 'plain object control', make: () => ({ city: 'London' }), expected: '{"city":"London"}' },
  {
    name: 'cycle',
    make: () => {
      const value: Record<string, unknown> = { city: 'London' }
      value.self = value
      return value
    },
    expected: '[object Object]',
  },
  { name: 'BigInt', make: () => ({ count: BigInt(1) }), expected: '[object Object]' },
  {
    name: 'throwing toJSON',
    make: () => ({
      toJSON: () => {
        throw serializationError
      },
    }),
    expected: '[object Object]',
  },
  {
    name: 'throwing toPrimitive after failed JSON serialization',
    make: () => ({
      count: BigInt(1),
      [Symbol.toPrimitive]: () => {
        throw new Error('application toPrimitive failed')
      },
    }),
    expected: '',
  },
  {
    name: 'throwing toString after failed JSON serialization',
    make: () => ({
      toJSON: () => {
        throw serializationError
      },
      toString: () => {
        throw new Error('application toString failed')
      },
    }),
    expected: '',
  },
  {
    name: 'null-prototype cycle',
    make: () => {
      const value: Record<string, unknown> = Object.create(null)
      value.self = value
      return value
    },
    expected: '',
  },
  {
    name: 'null-prototype BigInt',
    make: () => Object.assign(Object.create(null), { count: BigInt(1) }),
    expected: '',
  },
  {
    name: 'custom string fallback control',
    make: () => ({ count: BigInt(1), toString: () => 'custom arguments' }),
    expected: 'custom arguments',
  },
  {
    name: 'JSON succeeds without coercion control',
    make: () => ({
      city: 'London',
      [Symbol.toPrimitive]: () => {
        throw new Error('coercion must not run')
      },
    }),
    expected: '{"city":"London"}',
  },
]
const vercelCases = [
  { name: 'JSON string control', make: () => '{"city":"London"}', expected: '{"city":"London"}' },
  ...cases,
]
const client = () => ({ capture: vi.fn(), captureImmediate: vi.fn(), privacy_mode: false })
const outcome = async <T>(call: () => T) => {
  try {
    return { status: 'fulfilled', value: await call() } as const
  } catch (reason) {
    return { status: 'rejected', reason } as const
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe.each(['v2', 'v3'] as const)('Vercel %s provider invocation', (version) => {
  const usage =
    version === 'v2' ? { inputTokens: 1, outputTokens: 1 } : { inputTokens: { total: 1 }, outputTokens: { total: 1 } }
  const finishReason = version === 'v2' ? 'tool-calls' : { unified: 'tool-calls', raw: undefined }
  const makeModel = (doGenerate = vi.fn(), doStream = vi.fn()) =>
    ({
      specificationVersion: version,
      provider: 'test.provider',
      modelId: 'test-model',
      supportedUrls: {},
      doGenerate,
      doStream,
    }) as unknown as LanguageModelV2 | LanguageModelV3

  it.each(vercelCases)('doGenerate preserves provider success: $name', async ({ make, expected }) => {
    // Object-valued output arguments are off-spec for V2/V3, but explicitly
    // handled by mapVercelOutput. This probes that compatibility branch.
    const args = make()
    const result = {
      content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'weather', input: args }],
      usage,
      finishReason,
      warnings: [],
    }
    const receivers: unknown[] = []
    const provider = vi.fn(async function (this: unknown, _params: unknown) {
      receivers.push(this)
      return result
    })
    const model = makeModel(provider)
    const capture = client()
    const wrapped = withTracing(model, capture as unknown as PostHog, {})
    const params = { prompt: [] }
    const baseline = await outcome(() => model.doGenerate(params))
    const instrumented = await outcome(() => wrapped.doGenerate(params))
    expect(baseline.status).toBe('fulfilled')
    if (baseline.status === 'fulfilled') expect(baseline.value).toBe(result)
    expect(provider).toHaveBeenCalledTimes(2)
    expect(provider.mock.calls[0][0]).toBe(params)
    expect(provider.mock.calls[1][0]).toBe(params)
    expect(receivers).toEqual([model, model])
    expect(capture.capture).toHaveBeenCalledWith(expect.objectContaining({ event: '$ai_generation' }))
    const event = capture.capture.mock.calls.find(([event]) => event.event === '$ai_generation')![0]
    const output = event.properties.$ai_output_choices[0]
    expect(output.content[0].function.arguments).toBe(expected)
    expect(instrumented.status, instrumented.status === 'rejected' ? String(instrumented.reason) : '').toBe('fulfilled')
    if (instrumented.status === 'fulfilled') expect(instrumented.value).toBe(result)
  })

  it.each(cases)('doGenerate preserves original provider rejection with prompt arguments: $name', async ({ make }) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const originalError = new Error('original provider failure')
    const provider = vi.fn().mockRejectedValue(originalError)
    const model = makeModel(provider)
    const capture = client()
    const wrapped = withTracing(model, capture as unknown as PostHog, {})
    const params = {
      prompt: [
        {
          role: 'assistant' as const,
          content: [{ type: 'tool-call' as const, toolCallId: 'call-1', toolName: 'weather', input: make() }],
        },
      ],
    }
    const baseline = await outcome(() => model.doGenerate(params))
    const instrumented = await outcome(() => wrapped.doGenerate(params))
    expect(baseline.status).toBe('rejected')
    if (baseline.status === 'rejected') expect(baseline.reason).toBe(originalError)
    expect(provider).toHaveBeenCalledTimes(2)
    expect(provider.mock.calls[1][0]).toBe(params)
    expect(instrumented.status).toBe('rejected')
    if (instrumented.status === 'rejected') expect(instrumented.reason).toBe(originalError)
  })

  it.each(cases)('doStream preserves chunks and original read failure: $name', async ({ make }) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const args = make()
    const chunks = [
      { type: 'tool-call', toolCallId: 'call-1', toolName: 'weather', input: args },
      { type: 'finish', usage, finishReason },
    ]
    const originalError = new Error('original provider read failure')
    const provider = vi.fn().mockImplementation(async () => {
      let index = 0
      return {
        marker: 'provider metadata',
        stream: new ReadableStream(
          {
            pull(controller) {
              if (index < chunks.length) controller.enqueue(chunks[index++])
              else controller.error(originalError)
            },
          },
          { highWaterMark: 0 }
        ),
      }
    })
    const model = makeModel(vi.fn(), provider)
    const wrapped = withTracing(model, client() as unknown as PostHog, {})
    const params = { prompt: [] }
    for (const target of [model, wrapped]) {
      const result = await target.doStream(params)
      expect((result as any).marker).toBe('provider metadata')
      const reader = result.stream.getReader()
      for (const chunk of chunks) expect((await reader.read()).value).toBe(chunk)
      await expect(reader.read()).rejects.toBe(originalError)
    }
    expect(provider).toHaveBeenCalledTimes(2)
    expect(provider.mock.calls[1][0]).toBe(params)
  })
})

describe.each([false, true])('LangChain callback via model.invoke (raiseError=%s)', (raiseError) => {
  it.each(cases)('preserves returned tool-call message: $name', async ({ make, expected }) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const args = make()
    const response = new AIMessage({ content: '', tool_calls: [{ id: 'call-1', name: 'weather', args }] })
    const model = new FakeToolCallingModel()
    const provider = vi.spyOn(model, '_generate').mockResolvedValue({ generations: [{ text: '', message: response }] })
    const capture = client()
    const callback = new LangChainCallbackHandler({ client: capture as unknown as PostHog })
    // Inherited LangChain setting, not a new PostHog API. Default is false.
    callback.raiseError = raiseError
    callback.awaitHandlers = true
    const end = vi.spyOn(callback, 'handleLLMEnd')
    const messages = [new HumanMessage('Weather?')]
    const baseline = await outcome(() => model.invoke(messages))
    const instrumented = await outcome(() => model.invoke(messages, { callbacks: [callback] }))
    expect(baseline.status).toBe('fulfilled')
    if (baseline.status === 'fulfilled') expect(baseline.value).toBe(response)
    expect(provider).toHaveBeenCalledTimes(2)
    expect(end).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
    expect(capture.capture).toHaveBeenCalledWith(expect.objectContaining({ event: '$ai_generation' }))
    const event = capture.capture.mock.calls.find(([event]) => event.event === '$ai_generation')![0]
    expect(event.properties.$ai_output_choices[0].tool_calls[0].function.arguments).toBe(expected)
    expect(instrumented.status, instrumented.status === 'rejected' ? String(instrumented.reason) : '').toBe('fulfilled')
    if (instrumented.status === 'fulfilled') {
      expect(instrumented.value).toBe(response)
      expect(instrumented.value.tool_calls?.[0].args).toBe(args)
    }
  })

  it.each(cases)('preserves provider rejection with prompt tool arguments: $name', async ({ make }) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const originalError = new Error('original LangChain provider failure')
    const model = new FakeToolCallingModel()
    const provider = vi.spyOn(model, '_generate').mockRejectedValue(originalError)
    const callback = new LangChainCallbackHandler({ client: client() as unknown as PostHog })
    callback.raiseError = raiseError
    callback.awaitHandlers = true
    const messages = [new AIMessage({ content: '', tool_calls: [{ id: 'call-1', name: 'weather', args: make() }] })]
    const baseline = await outcome(() => model.invoke(messages))
    const instrumented = await outcome(() => model.invoke(messages, { callbacks: [callback] }))
    expect(baseline.status).toBe('rejected')
    if (baseline.status === 'rejected') expect(baseline.reason).toBe(originalError)
    expect.soft(provider).toHaveBeenCalledTimes(2)
    expect(instrumented.status).toBe('rejected')
    if (instrumented.status === 'rejected') expect(instrumented.reason).toBe(originalError)
  })
})

describe('LangChain middleware tool invocation boundary', () => {
  it.each(cases)('preserves handler arguments, result identity, and original failure: $name', async ({ make }) => {
    const capture = client()
    const middleware = createPostHogMiddleware({ client: capture as unknown as PostHog }) as any
    const args = make()
    const request = {
      toolCall: { id: 'call-1', name: 'weather', args, type: 'tool_call' },
      tool: { name: 'weather' },
      state: {},
      runtime: {},
    }
    const result = { applicationValue: args }
    const originalError = new Error('original tool failure')
    for (const fails of [false, true]) {
      const handler = vi.fn(async (received) => {
        expect(received).toBe(request)
        expect(received.toolCall.args).toBe(args)
        if (fails) throw originalError
        return result
      })
      const baseline = await outcome(() => handler(request))
      const instrumented = await outcome(() => middleware.wrapToolCall(request, handler))
      expect(handler).toHaveBeenCalledTimes(2)
      expect(instrumented.status).toBe(baseline.status)
      if (baseline.status === 'fulfilled' && instrumented.status === 'fulfilled') {
        expect(baseline.value).toBe(result)
        expect(instrumented.value).toBe(result)
      } else if (baseline.status === 'rejected' && instrumented.status === 'rejected') {
        expect(baseline.reason).toBe(originalError)
        expect(instrumented.reason).toBe(originalError)
      }
    }
    expect(capture.capture).toHaveBeenCalledWith(expect.objectContaining({ event: '$ai_span' }))
  })
})
