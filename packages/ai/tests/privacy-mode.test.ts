import { PostHog } from 'posthog-node'
import { APICallError, TypeValidationError } from '@ai-sdk/provider'
import { HumanMessage, ToolMessage } from '@langchain/core/messages'
import { OutputParserException } from '@langchain/core/output_parsers'
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-base'

import PostHogOpenAI from '../src/openai'
import PostHogAnthropic from '../src/anthropic'
import PostHogGoogleGenAI from '../src/gemini'
import { withTracing } from '../src/vercel'
import { LangChainCallbackHandler } from '../src/langchain/callbacks'
import { createPostHogMiddleware } from '../src/langchain/middleware'
import { PostHogSpanProcessor } from '../src/otel'

const CANARY = 'CANARY_7f3a'
const REQUEST_ID = 'req_0001'

type Delivery = { client: PostHog; delivered: () => Promise<string>; urls: string[] }

function realClient(): Delivery {
  const bodies: string[] = []
  const urls: string[] = []
  const client = new PostHog('phc_privacy_test', {
    host: 'http://localhost',
    privacyMode: true,
    enableExceptionAutocapture: true,
    fetchRetryCount: 0,
    disableCompression: true,
    // The AI lane ignores disableCompression.
    captureAiCompression: 'none',
    fetch: async (url, options) => {
      urls.push(url)
      bodies.push(String(options.body))
      return { status: 200, text: async () => '{}', json: async () => ({}) }
    },
  })
  return {
    client,
    urls,
    delivered: async () => {
      await client.shutdown()
      return bodies.join('\n')
    },
  }
}

function providerFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', 'x-request-id': REQUEST_ID, 'request-id': REQUEST_ID },
      })
  )
}

const ignoreRejection = async (call: () => Promise<unknown>): Promise<void> => {
  await call().catch(() => undefined)
}

const lookupTool = {
  type: 'function' as const,
  function: { name: 'lookup', parameters: { type: 'object', properties: { q: { type: 'string' } } } },
}

const openAIMessages = [
  { role: 'system' as const, content: `Answer as ${CANARY}` },
  { role: 'user' as const, content: `Find ${CANARY}` },
  {
    role: 'assistant' as const,
    content: null,
    tool_calls: [
      {
        id: 'call_1',
        type: 'function' as const,
        function: { name: 'lookup', arguments: JSON.stringify({ q: CANARY }) },
      },
    ],
  },
  { role: 'tool' as const, tool_call_id: 'call_1', content: `Found ${CANARY}` },
]

async function runOpenAI(client: PostHog): Promise<void> {
  vi.stubGlobal(
    'fetch',
    providerFetch(200, {
      id: 'chatcmpl_1',
      object: 'chat.completion',
      created: 0,
      model: 'gpt-4o-mini',
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: `Echo ${CANARY}`,
            tool_calls: [
              {
                id: 'call_2',
                type: 'function',
                function: { name: 'lookup', arguments: JSON.stringify({ q: CANARY }) },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    })
  )
  const succeeding = new PostHogOpenAI({ apiKey: 'sk-test', maxRetries: 0, posthog: client })
  await succeeding.chat.completions.create({ model: 'gpt-4o-mini', messages: openAIMessages, tools: [lookupTool] })

  vi.stubGlobal(
    'fetch',
    providerFetch(400, {
      error: {
        message: `Invalid content: ${CANARY}`,
        type: 'invalid_request_error',
        param: 'messages[1].content',
        code: 'invalid_value',
      },
    })
  )
  const failing = new PostHogOpenAI({ apiKey: 'sk-test', maxRetries: 0, posthog: client })
  const rethrown = await failing.chat.completions
    .create({ model: 'gpt-4o-mini', messages: openAIMessages, tools: [lookupTool] })
    .catch((error: unknown) => error)
  // Express, NestJS and the global handlers route the rethrown error through captureException.
  client.captureException(rethrown)
  await ignoreRejection(() =>
    failing.responses.create({
      model: 'gpt-4o-mini',
      input: `Find ${CANARY}`,
      tools: [
        {
          type: 'mcp',
          server_label: 'docs',
          server_url: 'https://mcp.example.com',
          headers: { Authorization: `Bearer ${CANARY}` },
          authorization: CANARY,
          require_approval: 'never',
        },
      ],
    })
  )
}

const anthropicMessages = [
  { role: 'user' as const, content: `Find ${CANARY}` },
  {
    role: 'assistant' as const,
    content: [{ type: 'tool_use' as const, id: 'toolu_1', name: 'lookup', input: { q: CANARY } }],
  },
  {
    role: 'user' as const,
    content: [{ type: 'tool_result' as const, tool_use_id: 'toolu_1', content: `Found ${CANARY}` }],
  },
]

async function runAnthropic(client: PostHog): Promise<void> {
  vi.stubGlobal(
    'fetch',
    providerFetch(200, {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-test',
      content: [
        { type: 'text', text: `Echo ${CANARY}` },
        { type: 'tool_use', id: 'toolu_2', name: 'lookup', input: { q: CANARY } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 5, output_tokens: 5 },
    })
  )
  const succeeding = new PostHogAnthropic({ apiKey: 'sk-ant-test', maxRetries: 0, posthog: client })
  await succeeding.messages.create({
    model: 'claude-test',
    max_tokens: 10,
    system: `Answer as ${CANARY}`,
    messages: anthropicMessages,
  })

  vi.stubGlobal(
    'fetch',
    providerFetch(400, { type: 'error', error: { type: 'invalid_request_error', message: `Bad ${CANARY}` } })
  )
  const failing = new PostHogAnthropic({ apiKey: 'sk-ant-test', maxRetries: 0, posthog: client })
  await ignoreRejection(() =>
    failing.messages.create({ model: 'claude-test', max_tokens: 10, messages: anthropicMessages })
  )
}

async function runGemini(client: PostHog): Promise<void> {
  const contents = [{ role: 'user', parts: [{ text: `Find ${CANARY}` }] }]
  vi.stubGlobal(
    'fetch',
    providerFetch(200, {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: `Echo ${CANARY}` }, { functionCall: { name: 'lookup', args: { q: CANARY } } }],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5, totalTokenCount: 10 },
    })
  )
  await new PostHogGoogleGenAI({ apiKey: 'test', posthog: client }).models.generateContent({
    model: 'gemini-test',
    contents,
    config: { systemInstruction: `Answer as ${CANARY}` },
  })

  vi.stubGlobal(
    'fetch',
    providerFetch(400, { error: { code: 400, message: `Bad ${CANARY}`, status: 'INVALID_ARGUMENT' } })
  )
  const failing = new PostHogGoogleGenAI({ apiKey: 'test', posthog: client })
  await ignoreRejection(() => failing.models.generateContent({ model: 'gemini-test', contents }))
  await ignoreRejection(() => failing.models.embedContent({ model: 'gemini-embedding', contents: `Embed ${CANARY}` }))
}

const vercelPrompt = [
  { role: 'system', content: `Answer as ${CANARY}` },
  { role: 'user', content: [{ type: 'text', text: `Find ${CANARY}` }] },
]

const vercelCallError = (): APICallError =>
  new APICallError({
    message: `Bad request: ${CANARY}`,
    url: 'https://api.example.com/v1/chat',
    requestBodyValues: { messages: [{ role: 'user', content: CANARY }] },
    statusCode: 400,
    responseBody: JSON.stringify({
      error: { message: `Rejected ${CANARY}`, type: 'invalid_request_error', param: 'messages[3].content' },
    }),
    cause: new TypeValidationError({ value: { echoed: CANARY }, cause: new Error(CANARY) }),
  })

async function runVercel(client: PostHog): Promise<void> {
  let fail = false
  const model = {
    specificationVersion: 'v2',
    provider: 'test-provider',
    modelId: 'test-model',
    supportedUrls: {},
    doGenerate: async () => {
      if (fail) {
        throw vercelCallError()
      }
      return {
        content: [
          { type: 'text', text: `Echo ${CANARY}` },
          { type: 'tool-call', toolCallId: 'call_1', toolName: 'lookup', input: JSON.stringify({ q: CANARY }) },
        ],
        finishReason: 'tool-calls',
        usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
        providerMetadata: { google: { groundingMetadata: { webSearchQueries: [CANARY] } } },
        warnings: [],
      }
    },
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-delta', id: 't1', delta: `Echo ${CANARY}` })
          controller.enqueue({ type: 'error', error: vercelCallError() })
          controller.enqueue({
            type: 'finish',
            finishReason: 'error',
            usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
            providerMetadata: { google: { groundingMetadata: { webSearchQueries: [CANARY] } } },
          })
          controller.close()
        },
      }),
    }),
  }
  const wrapped = withTracing(model as any, client, {})
  const params = { prompt: vercelPrompt } as any

  await wrapped.doGenerate(params)
  fail = true
  await ignoreRejection(() => wrapped.doGenerate(params))

  const { stream } = await wrapped.doStream(params)
  const reader = stream.getReader()
  while (!(await reader.read()).done) {
    // Drain the stream so the wrapper finalizes its capture.
  }
  await new Promise((resolve) => setImmediate(resolve))

  const cancelled = await wrapped.doStream(params)
  await cancelled.stream.cancel(vercelCallError())
  await new Promise((resolve) => setImmediate(resolve))
}

async function runLangChainCallbacks(client: PostHog): Promise<void> {
  const handler = new LangChainCallbackHandler({ client })
  const serialized = { lc: 1, type: 'not_implemented' as const, id: ['langchain', 'chat_models', 'openai'] }

  handler.handleChainStart(serialized, { question: `Find ${CANARY}` }, 'root')
  handler.handleChatModelStart(serialized, [[new HumanMessage(`Find ${CANARY}`)]], 'generation', 'root', {
    invocation_params: { model: 'gpt-4o-mini', tools: [lookupTool] },
  })
  handler.handleLLMError(new OutputParserException(`Could not parse ${CANARY}`, CANARY), 'generation', 'root')
  handler.handleChainStart(serialized, { query: CANARY }, 'child', 'root')
  handler.handleChainError(new OutputParserException(`Could not parse ${CANARY}`, CANARY), 'child', 'root')
  handler.handleChainError(new Error(CANARY), 'root')
}

async function runLangChainMiddleware(client: PostHog): Promise<void> {
  const middleware = createPostHogMiddleware({ client }) as any
  const state = middleware.beforeAgent({ messages: [new HumanMessage(`Find ${CANARY}`)] }, {})
  const toolRequest = {
    toolCall: { id: 'call_1', name: 'lookup', args: { q: CANARY }, type: 'tool_call' },
    tool: { name: 'lookup' },
    state,
    runtime: {},
  }

  await middleware.wrapToolCall(toolRequest, () =>
    Promise.resolve(new ToolMessage({ content: `Failed ${CANARY}`, tool_call_id: 'call_1', status: 'error' }))
  )
  await ignoreRejection(() => middleware.wrapToolCall(toolRequest, () => Promise.reject({ detail: CANARY })))
}

describe('privacy mode on a real posthog-node client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ['OpenAI', runOpenAI],
    ['Anthropic', runAnthropic],
    ['Gemini', runGemini],
    ['Vercel AI SDK', runVercel],
    ['LangChain callbacks', runLangChainCallbacks],
    ['LangChain middleware', runLangChainMiddleware],
  ])('sends no prompt, output, tool or error content from %s', async (_name, run) => {
    const { client, delivered, urls } = realClient()

    await run(client)
    const payload = await delivered()

    expect(urls).toContain('http://localhost/i/v1/ai/events')
    expect(payload).toContain('$ai_')
    expect(payload).not.toContain(CANARY)
  })

  it('summarizes provider errors from their structured fields', async () => {
    const { client, delivered } = realClient()

    await runOpenAI(client)
    await runVercel(client)
    const errors = (await delivered())
      .split('\n')
      .flatMap((body) => JSON.parse(body).batch)
      .map((event: { properties: Record<string, unknown> }) => event.properties.$ai_error)
      .filter((error: unknown) => error !== undefined)

    expect(errors).toEqual(
      expect.arrayContaining([
        `BadRequestError: 400 invalid_value invalid_request_error param=messages[1].content request_id=${REQUEST_ID}`,
        'AI_APICallError: 400 invalid_request_error param=messages[3].content (caused by AI_TypeValidationError, Error)',
      ])
    )
  })

  it('strips content from OTel spans when the client is in privacy mode', () => {
    const { client } = realClient()
    const exported: ReadableSpan[] = []
    const inner: SpanProcessor = {
      onStart: () => undefined,
      onEnd: (span) => exported.push(span),
      shutdown: () => Promise.resolve(),
      forceFlush: () => Promise.resolve(),
    }
    const processor = new PostHogSpanProcessor({ projectToken: 'phc_test', client, _spanProcessor: inner })
    const span = {
      name: 'ai.generateText.doGenerate',
      attributes: {
        'ai.operationId': 'ai.generateText.doGenerate',
        'ai.prompt.messages': JSON.stringify([{ role: 'user', content: CANARY }]),
        'ai.response.text': CANARY,
        'gen_ai.input.messages': JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: CANARY }] }]),
        'gen_ai.prompt.0.content': CANARY,
        'gen_ai.usage.input_tokens': 5,
      },
      events: [
        { name: 'gen_ai.user.message', attributes: { content: CANARY }, time: [0, 0] },
        {
          name: 'exception',
          attributes: { 'exception.type': 'AI_APICallError', 'exception.message': CANARY },
          time: [0, 0],
        },
      ],
      status: { code: 2, message: CANARY },
    } as unknown as ReadableSpan

    processor.onStart(span as any, {} as any)
    processor.onEnd(span)

    expect(exported).toHaveLength(1)
    expect(exported[0].attributes).toEqual({
      'ai.operationId': 'ai.generateText.doGenerate',
      'gen_ai.usage.input_tokens': 5,
    })
    expect(exported[0].events).toEqual([
      { name: 'exception', attributes: { 'exception.type': 'AI_APICallError' }, time: [0, 0] },
    ])
    expect(exported[0].status).toEqual({ code: 2 })
  })
})
