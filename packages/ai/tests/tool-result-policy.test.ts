import OpenAIOriginal from 'openai'
import AnthropicOriginal from '@anthropic-ai/sdk'
import { toJsonSafeValue } from '@posthog/core'
import type { PostHog } from 'posthog-node'
import PostHogOpenAI from '../src/openai'
import PostHogAnthropic from '../src/anthropic'
import PostHogGemini from '../src/gemini'
import { formatContent, formatUserContent } from '../src/claude-agent-sdk/formatting'
import { buildChatErrorOptions, buildResponsesErrorOptions } from '../src/openai/telemetry'

const marker = '... [truncated]'
const bytes = (text: string) => new TextEncoder().encode(text).byteLength
const providerNames = ['gemini', 'openai-chat', 'openai-responses', 'anthropic'] as const
type ProviderName = (typeof providerNames)[number]

function phClient(full = false, privacy = false) {
  return {
    capture: vi.fn(),
    captureImmediate: vi.fn(),
    enableFullAiCapture: full,
    privacy_mode: privacy,
  } as unknown as PostHog
}

function history(content: unknown, full = false) {
  return (
    formatUserContent(
      [{ type: 'tool_result', tool_use_id: 'call_1', content, is_error: true }],
      phClient(full)
    ) as any[]
  )[0]
}

async function callAdapter(
  provider: ProviderName,
  content: unknown,
  options: { full?: boolean; privacy?: boolean; error?: Error; callId?: string } = {}
) {
  const posthog = phClient(options.full, options.privacy)
  const callId = options.callId ?? 'call_1'
  let spy: any
  let request: any
  let invoke: () => Promise<any>
  let response: any
  if (provider === 'gemini') {
    const client = new PostHogGemini({ apiKey: 'synthetic-key', posthog })
    spy = vi.spyOn((client as any).client.models, 'generateContent')
    request = {
      model: 'synthetic-model',
      contents: [{ role: 'user', parts: [{ functionResponse: { id: callId, name: 'lookup', response: content } }] }],
      posthogDistinctId: 'test-user',
    }
    response = {
      candidates: [{ content: { parts: [{ text: 'done' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2 },
    }
    invoke = () => client.models.generateContent(request)
  } else if (provider === 'openai-chat') {
    spy = vi.spyOn(OpenAIOriginal.Chat.Completions.prototype, 'create')
    const client = new PostHogOpenAI({ apiKey: 'synthetic-key', posthog })
    request = {
      model: 'synthetic-model',
      messages: [{ role: 'tool', tool_call_id: callId, content }],
      posthogDistinctId: 'test-user',
    }
    response = {
      id: 'completion_1',
      model: 'synthetic-model',
      choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 7, completion_tokens: 2 },
    }
    invoke = () => client.chat.completions.create(request)
  } else if (provider === 'openai-responses') {
    spy = vi.spyOn(OpenAIOriginal.Responses.prototype, 'create')
    const client = new PostHogOpenAI({ apiKey: 'synthetic-key', posthog })
    request = {
      model: 'synthetic-model',
      input: [{ type: 'function_call_output', call_id: callId, id: 'output_1', output: content, status: 'completed' }],
      posthogDistinctId: 'test-user',
    }
    response = {
      id: 'response_1',
      model: 'synthetic-model',
      status: 'completed',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] }],
      usage: { input_tokens: 7, output_tokens: 2 },
    }
    invoke = () => client.responses.create(request)
  } else {
    spy = vi.spyOn(AnthropicOriginal.Messages.prototype, 'create')
    const client = new PostHogAnthropic({ apiKey: 'synthetic-key', posthog })
    request = {
      model: 'synthetic-model',
      max_tokens: 20,
      messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: callId, content, is_error: true }] }],
      posthogDistinctId: 'test-user',
    }
    response = {
      id: 'message_1',
      model: 'synthetic-model',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'done' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 7, output_tokens: 2 },
    }
    invoke = () => client.messages.create(request)
  }
  if (options.error) spy.mockRejectedValue(options.error)
  else spy.mockResolvedValue(response)
  if (options.error) await expect(invoke()).rejects.toBe(options.error)
  else expect(await invoke()).toBe(response)
  expect(spy).toHaveBeenCalledTimes(1)
  const { posthogDistinctId: _omitted, ...providerRequest } = request
  expect(spy.mock.calls[0][0]).toEqual(providerRequest)
  await vi.waitFor(() => expect(posthog.capture).toHaveBeenCalledTimes(1))
  const event = (posthog.capture as vi.Mock).mock.calls[0][0]
  const input = event.properties.$ai_input
  let captured: unknown
  if (input !== null) {
    if (provider === 'gemini') {
      expect(input[0].role).toBe('user')
      expect(input[0].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: callId })
      captured = input[0].content[0].content
    } else if (provider === 'openai-chat') {
      expect(input[0]).toMatchObject({ role: 'tool', tool_call_id: callId })
      captured = input[0].content
    } else if (provider === 'openai-responses') {
      expect(input[0].role).toBe('user')
      // Responses historically stores each input item as serialized content.
      const item = JSON.parse(input[0].content)
      expect(item).toMatchObject({
        type: 'function_call_output',
        call_id: callId,
        id: 'output_1',
        status: 'completed',
      })
      captured = item.output
    } else {
      expect(input[0].role).toBe('user')
      expect(input[0].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: callId, is_error: true })
      captured = input[0].content[0].content
    }
  }
  return { captured, event, response, request }
}

afterEach(() => vi.restoreAllMocks())

describe('Claude tool-result history characterization', () => {
  test.each([
    ['!'.repeat(5000), '!'.repeat(5000)],
    ['!'.repeat(5001), '!'.repeat(5000) + marker],
    ['!'.repeat(4999) + '😀', '!'.repeat(4999) + marker],
    ['é'.repeat(2501), 'é'.repeat(2500) + marker],
  ])('caps each UTF-8 string without splitting a character', (text, expected) => {
    const input = { body: text, summary: '42 rows matched', nested: [text, { answer: 42 }] }
    const captured = history(input)
    expect(captured).toEqual({
      type: 'tool_result',
      tool_use_id: 'call_1',
      is_error: true,
      content: { body: expected, summary: '42 rows matched', nested: [expected, { answer: 42 }] },
    })
    expect(bytes(captured.content.body)).toBeLessThanOrEqual(5015)
    expect(captured.content.body).not.toContain('\ufffd')
    expect(input.body).toBe(text)
  })

  test('retains many small fields even when the aggregate is larger than 5000 bytes', () => {
    const input = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`field_${index}`, `value_${index}`]))
    expect(bytes(JSON.stringify(input))).toBeGreaterThan(5000)
    expect(history(input).content).toEqual(input)
  })

  test('does not parse a tool result that merely looks like JSON', () => {
    const input = '{"body":"' + '!'.repeat(6000) + '","summary":"keep as text"}'
    expect(history(input).content).toBe(input.slice(0, 5000) + marker)
    expect(typeof history('{"answer":42}').content).toBe('string')
  })

  test('keeps the original tool-span and assistant-output 200000-byte default', () => {
    const input = { body: '!'.repeat(200001), summary: 'preserved' }
    expect(formatContent(input, phClient())).toEqual({ body: '!'.repeat(200000) + marker, summary: 'preserved' })
    expect(history(input).content).toEqual({ body: '!'.repeat(5000) + marker, summary: 'preserved' })
    expect(formatContent(input, phClient(true))).toEqual(input)
  })

  test.each([false, true])('retains traversal safeguards and alias/cycle semantics (full=%s)', (full) => {
    const shared = { value: 'shared' }
    const cyclic: any = { value: 'root', first: shared, second: shared }
    cyclic.self = cyclic
    let deep: any = 'leaf'
    for (let depth = 0; depth < 30; depth++) deep = { nested: deep }
    for (const value of [cyclic, deep, Array.from({ length: 1100 }, (_, index) => index)]) {
      expect(history(value, full).content).toEqual(toJsonSafeValue(value))
    }
  })
})

describe('cross-adapter tool-result history policy', () => {
  test.each(providerNames)('%s preserves result structure and later fields while capping strings', async (provider) => {
    const input = { body: '!'.repeat(6000), summary: '42 rows matched', nested: [{ text: 'é'.repeat(3000) }] }
    const original = structuredClone(input)
    const { captured, event } = await callAdapter(provider, input)
    expect(captured).toEqual({
      body: '!'.repeat(5000) + marker,
      summary: '42 rows matched',
      nested: [{ text: 'é'.repeat(2500) + marker }],
    })
    expect(event.properties).toMatchObject({ $ai_input_tokens: 7, $ai_output_tokens: 2 })
    expect(input).toEqual(original)
  })

  test.each(providerNames)('%s retains many small fields and never parses arbitrary JSON text', async (provider) => {
    const fields = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`field_${index}`, `value_${index}`]))
    expect((await callAdapter(provider, fields)).captured).toEqual(fields)
    vi.restoreAllMocks()
    const text = '{"body":"' + '!'.repeat(6000) + '","summary":"still text"}'
    expect((await callAdapter(provider, text)).captured).toBe(text.slice(0, 5000) + marker)
  })

  test.each(providerNames)(
    '%s applies the same history policy on provider errors and preserves error identity',
    async (provider) => {
      const error = new Error('original provider failure')
      const input = { body: '!'.repeat(6000), summary: 'failure context' }
      const { captured, event } = await callAdapter(provider, input, { error })
      expect(captured).toEqual({ body: '!'.repeat(5000) + marker, summary: 'failure context' })
      expect(event.properties.$ai_is_error).toBe(true)
    }
  )

  test.each(providerNames)(
    '%s bypasses caps and binary redaction in full capture; privacy still wins',
    async (provider) => {
      const input = { body: '!'.repeat(6000), image: { mimeType: 'image/png', data: 'data:image/png;base64,aGVsbG8=' } }
      expect((await callAdapter(provider, input, { full: true })).captured).toEqual(input)
      vi.restoreAllMocks()
      const { event } = await callAdapter(provider, input, { full: true, privacy: true })
      expect(event.properties.$ai_input).toBeNull()
      expect(event.properties.$ai_output_choices).toBeNull()
    }
  )

  test.each(providerNames)(
    '%s redacts typed binary before normalization without losing MIME or later fields',
    async (provider) => {
      const data = new Uint8Array([1, 2, 3, 4])
      const input = { media: { mimeType: 'image/png', data }, summary: 'kept' }
      expect((await callAdapter(provider, input)).captured).toEqual({
        media: { mimeType: 'image/png', data: '[base64 image/png redacted]' },
        summary: 'kept',
      })
      expect([...data]).toEqual([1, 2, 3, 4])
    }
  )

  test.each(providerNames)(
    '%s preserves an own __proto__ tool-result field without changing object prototypes',
    async (provider) => {
      const input = JSON.parse('{"__proto__":{"safe":true},"summary":"later"}')
      const { captured } = await callAdapter(provider, input)
      expect(Object.hasOwn(captured as object, '__proto__')).toBe(true)
      expect(Object.getPrototypeOf(captured)).toBe(Object.prototype)
      expect(captured).toEqual(input)
      expect(Object.hasOwn(input, '__proto__')).toBe(true)
      expect(Object.getPrototypeOf(input)).toBe(Object.prototype)
      expect(({} as any).safe).toBeUndefined()
    }
  )

  test.each(providerNames)('%s leaves linking IDs outside the capped result untouched', async (provider) => {
    const callId = '!'.repeat(6000)
    expect((await callAdapter(provider, 'small result', { callId })).captured).toBe('small result')
  })

  test.each(providerNames)(
    '%s avoids observing private result content even when full capture is enabled',
    async (provider) => {
      let reads = 0
      const content = {
        get secret() {
          reads++
          throw new Error('private content must not be inspected')
        },
      }
      const { event } = await callAdapter(provider, content, { full: true, privacy: true })
      expect(event.properties.$ai_input).toBeNull()
      expect(reads).toBe(0)
    }
  )

  test.each(providerNames)(
    '%s safely handles pathological result content without replacing provider outcomes',
    async (provider) => {
      const content = {
        get value() {
          throw new Error('telemetry-only getter')
        },
      }
      const { response } = await callAdapter(provider, content)
      expect(response).toBeDefined()
      vi.restoreAllMocks()
      await callAdapter(provider, content, { error: new Error('original failure') })
    }
  )
})

describe('recognized provider envelopes', () => {
  const context = {
    client: phClient(),
    provider: 'openai' as const,
    baseURL: 'https://api.openai.com',
    monitoring: { traceId: 'trace', privacyMode: false },
    modelParametersSource: {},
  }

  test.each([
    'function_call_output',
    'custom_tool_call_output',
    'computer_call_output',
    'local_shell_call_output',
    'shell_call_output',
    'apply_patch_call_output',
    'mcp_call',
  ])('caps only the output of the Responses %s envelope, preserving its serialized representation', (type) => {
    const item = {
      type,
      call_id: '!'.repeat(6000),
      id: 'item_1',
      status: 'completed',
      name: 'lookup',
      output: { stdout: '!'.repeat(6000), stderr: 'later field' },
    }
    const original = structuredClone(item)
    const options = buildResponsesErrorOptions(
      { ...context, params: { model: 'synthetic-model', input: [item] } as any },
      new Error('provider failure'),
      { latency: 1 }
    )
    const message = (options.input as any[])[0]
    expect(message.role).toBe('user')
    expect(typeof message.content).toBe('string')
    expect(JSON.parse(message.content)).toEqual({
      ...item,
      output: { stdout: '!'.repeat(5000) + marker, stderr: 'later field' },
    })
    expect(bytes(message.content)).toBeGreaterThan(10000)
    expect(item).toEqual(original)
  })

  test('caps raw Responses strings before JSON escaping without truncating the serialized envelope', () => {
    const raw = '\n"\\'.repeat(2000)
    const item = {
      type: 'function_call_output',
      call_id: 'call_escaped',
      output: { body: raw, summary: 'later field survives' },
    }
    const options = buildResponsesErrorOptions(
      { ...context, params: { model: 'synthetic-model', input: [item] } as any },
      new Error('failure'),
      { latency: 1 }
    )
    const serialized = (options.input as any[])[0].content
    expect(bytes(serialized)).toBeGreaterThan(10000)
    const decoded = JSON.parse(serialized)
    expect(decoded.call_id).toBe('call_escaped')
    expect(decoded.output.body).toBe(raw.slice(0, 5000) + marker)
    expect(bytes(decoded.output.body)).toBe(5015)
    expect(decoded.output.summary).toBe('later field survives')
    expect(item.output.body).toBe(raw)
  })

  test('does not treat unknown Responses items, user text, or tool-call arguments as results', () => {
    const input = [
      { type: 'future_item', output: '!'.repeat(6000) },
      { type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: '!'.repeat(6000) },
      { role: 'user', content: '!'.repeat(6000) },
    ]
    const options = buildResponsesErrorOptions(
      { ...context, params: { model: 'synthetic-model', input } as any },
      new Error('failure'),
      { latency: 1 }
    )
    const messages = options.input as any[]
    expect(JSON.parse(messages[0].content)).toEqual(input[0])
    expect(JSON.parse(messages[1].content)).toEqual(input[1])
    expect(messages[2].content).toBe(input[2].content)
  })

  test('supports legacy Chat function messages without applying the cap to ordinary messages', () => {
    const messages = [
      { role: 'user', content: '!'.repeat(6000) },
      { role: 'assistant', content: '!'.repeat(6000) },
      { role: 'function', name: '!'.repeat(6000), content: '!'.repeat(6000) },
    ]
    const options = buildChatErrorOptions(
      { ...context, params: { model: 'synthetic-model', messages } as any },
      new Error('failure'),
      { latency: 1 }
    )
    expect(options.input).toEqual([messages[0], messages[1], { ...messages[2], content: '!'.repeat(5000) + marker }])
    expect(messages[2].content.length).toBe(6000)
  })

  test.each([
    'tool_result',
    'bash_code_execution_tool_result',
    'code_execution_tool_result',
    'text_editor_code_execution_tool_result',
    'tool_search_tool_result',
    'web_fetch_tool_result',
    'web_search_tool_result',
  ])('caps direct Anthropic %s content and retains the block envelope and adjacent blocks', async (type) => {
    const posthog = phClient()
    const response = {
      content: [{ type: 'text', text: 'done' }],
      usage: { input_tokens: 7, output_tokens: 2 },
      stop_reason: 'end_turn',
    }
    const spy = vi.spyOn(AnthropicOriginal.Messages.prototype, 'create').mockResolvedValue(response as any)
    const client = new PostHogAnthropic({ apiKey: 'synthetic-key', posthog })
    const block = {
      type,
      tool_use_id: '!'.repeat(6000),
      is_error: true,
      cache_control: { type: 'ephemeral' },
      content: { body: '!'.repeat(6000), summary: 'later' },
    }
    const adjacent = { type: 'text', text: '!'.repeat(6000) }
    const messages = [{ role: 'user', content: [block, adjacent] }]
    expect(await client.messages.create({ model: 'synthetic-model', max_tokens: 20, messages } as any)).toBe(response)
    expect(spy.mock.calls[0][0].messages).toBe(messages)
    expect((posthog.capture as vi.Mock).mock.calls[0][0].properties.$ai_input).toEqual([
      {
        role: 'user',
        content: [{ ...block, content: { body: '!'.repeat(5000) + marker, summary: 'later' } }, adjacent],
      },
    ])
    expect(block.content.body.length).toBe(6000)
  })
})
