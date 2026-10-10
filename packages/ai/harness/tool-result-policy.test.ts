import { GoogleGenAI } from '@google/genai'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { PostHogGoogleGenAI } from '@posthog/ai/gemini'
import { PostHogOpenAI } from '@posthog/ai/openai'
import { PostHogAnthropic } from '@posthog/ai/anthropic'
import { PostHog } from 'posthog-node'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { startRecorder, startReplay } from './cassette'
import { startCollector } from './collector'

type Provider = 'gemini' | 'openai-chat' | 'openai-responses' | 'anthropic'
const providers: Provider[] = ['gemini', 'openai-chat', 'openai-responses', 'anthropic']
const cases = providers.flatMap((provider) =>
  [false, true].flatMap((stream) => [false, true].map((privacy) => ({ provider, stream, privacy })))
)
const body = '!'.repeat(4999) + '😀' + '!'.repeat(1000)
const capped = '!'.repeat(4999) + '... [truncated]'
const summary = '42 rows matched'
const model = 'synthetic-model'
const chatResult = {
  id: 'chat_synthetic',
  object: 'chat.completion',
  created: 1,
  model,
  choices: [{ index: 0, message: { role: 'assistant', content: 'Done' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
}
const responsesResult = {
  id: 'resp_synthetic',
  object: 'response',
  created_at: 1,
  model,
  status: 'completed',
  output: [
    {
      type: 'message',
      id: 'msg_synthetic',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'Done', annotations: [] }],
    },
  ],
  usage: { input_tokens: 7, output_tokens: 2, total_tokens: 9 },
}
const anthropicResult = {
  id: 'msg_synthetic',
  type: 'message',
  role: 'assistant',
  model,
  content: [{ type: 'text', text: 'Done' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 7, output_tokens: 2 },
}
const geminiResult = {
  candidates: [{ index: 0, content: { role: 'model', parts: [{ text: 'Done' }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2, totalTokenCount: 9 },
}
const dataFrame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
const eventFrame = (value: { type: string }) => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`

function providerRequest(provider: Provider, stream: boolean) {
  const text = [
    { type: 'text', text: body },
    { type: 'text', text: summary },
  ]
  if (provider === 'gemini')
    return {
      model,
      contents: [
        { role: 'model', parts: [{ functionCall: { id: 'call_1', name: 'lookup', args: {} } }] },
        { role: 'user', parts: [{ functionResponse: { id: 'call_1', name: 'lookup', response: { body, summary } } }] },
      ],
    }
  if (provider === 'openai-chat')
    return {
      model,
      stream,
      messages: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{}' } }],
        },
        { role: 'tool', tool_call_id: 'call_1', content: text },
      ],
    }
  if (provider === 'openai-responses')
    return {
      model,
      stream,
      input: [
        { type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: '{}' },
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: text.map((part) => ({ ...part, type: 'input_text' })),
        },
      ],
    }
  return {
    model,
    max_tokens: 20,
    stream,
    messages: [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'lookup', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', is_error: true, content: text }] },
    ],
  }
}

function wireResponse(provider: Provider, stream: boolean): string {
  if (!stream)
    return JSON.stringify(
      provider === 'gemini'
        ? geminiResult
        : provider === 'openai-chat'
          ? chatResult
          : provider === 'openai-responses'
            ? responsesResult
            : anthropicResult
    )
  if (provider === 'gemini') return dataFrame(geminiResult)
  if (provider === 'openai-chat')
    return (
      dataFrame({
        ...chatResult,
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'Done' }, finish_reason: 'stop' }],
      }) + 'data: [DONE]\n\n'
    )
  if (provider === 'openai-responses')
    return [
      {
        type: 'response.created',
        sequence_number: 0,
        response: { ...responsesResult, status: 'in_progress', output: [] },
      },
      {
        type: 'response.output_text.delta',
        sequence_number: 1,
        output_index: 0,
        content_index: 0,
        item_id: 'msg_synthetic',
        delta: 'Done',
      },
      { type: 'response.completed', sequence_number: 2, response: responsesResult },
    ]
      .map(eventFrame)
      .join('')
  return [
    {
      type: 'message_start',
      message: { ...anthropicResult, content: [], stop_reason: null, usage: { input_tokens: 7, output_tokens: 0 } },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } },
    { type: 'message_stop' },
  ]
    .map(eventFrame)
    .join('')
}

function client(provider: Provider, baseURL: string, posthog?: PostHog): any {
  if (provider === 'gemini') {
    const config = {
      apiKey: 'fake-provider-key',
      httpOptions: { baseUrl: baseURL, apiVersion: 'v1beta', timeout: 2000, retryOptions: { attempts: 1 } },
    }
    return posthog ? new PostHogGoogleGenAI({ ...config, posthog }) : new GoogleGenAI(config)
  }
  const config = {
    apiKey: 'fake-provider-key',
    baseURL: provider === 'anthropic' ? baseURL : `${baseURL}/v1`,
    maxRetries: 0,
    timeout: 2000,
  }
  if (provider === 'anthropic') return posthog ? new PostHogAnthropic({ ...config, posthog }) : new Anthropic(config)
  return posthog ? new PostHogOpenAI({ ...config, posthog }) : new OpenAI(config)
}

async function invoke(provider: Provider, sdk: any, stream: boolean, request: any) {
  const result = await (provider === 'gemini'
    ? stream
      ? sdk.models.generateContentStream(request)
      : sdk.models.generateContent(request)
    : provider === 'openai-chat'
      ? sdk.chat.completions.create(request)
      : provider === 'openai-responses'
        ? sdk.responses.create(request)
        : sdk.messages.create(request))
  const normalize = (value: any) =>
    provider === 'gemini'
      ? { candidates: value.candidates, usageMetadata: value.usageMetadata }
      : JSON.parse(JSON.stringify(value))
  if (!stream) return normalize(result)
  const events = []
  for await (const event of result) events.push(normalize(event))
  return events
}

it.each(cases)(
  'preserves built $provider tool history through real SDK HTTP (stream=$stream, privacy=$privacy)',
  async ({ provider, stream, privacy }) => {
    const directory = await mkdtemp(join(tmpdir(), 'tool-result-policy-'))
    const path = join(directory, 'synthetic.json')
    const requests: unknown[] = []
    const upstream = createServer(async (request, response) => {
      let text = ''
      for await (const chunk of request) text += chunk
      requests.push(JSON.parse(text))
      response.writeHead(200, { 'content-type': stream ? 'text/event-stream' : 'application/json' })
      response.end(wireResponse(provider, stream))
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    const address = upstream.address()
    if (!address || typeof address === 'string') throw new Error('Missing synthetic provider address')
    const upstreamURL = `http://127.0.0.1:${address.port}`
    // The existing Anthropic recorder intentionally supports streaming only.
    const recording =
      provider === 'anthropic' && !stream
        ? undefined
        : await startRecorder({
            path,
            upstreamURL,
            provenance: { source: 'synthetic', recordedAt: '2026-09-30T00:00:00Z', providerSdkVersion: 'test' },
          })
    const collector = await startCollector()
    const posthog = new PostHog('phc_cassette_test', {
      host: collector.url,
      flushAt: 1,
      flushInterval: 10,
      disableGeoip: true,
    })
    let replay: Awaited<ReturnType<typeof startReplay>> | undefined
    try {
      const request = providerRequest(provider, stream)
      const original = structuredClone(request)
      const nativeOutput = await invoke(provider, client(provider, recording?.url ?? upstreamURL), stream, request)
      if (recording) {
        await recording.finish()
        await recording.close()
        upstream.closeAllConnections()
        await new Promise<void>((resolve) => upstream.close(() => resolve()))
        replay = await startReplay({ path })
      }
      const wrappedOutput = await invoke(provider, client(provider, replay?.url ?? upstreamURL, posthog), stream, {
        ...request,
        posthogDistinctId: 'tool-result-test',
        posthogTraceId: 'tool-result-trace',
        posthogPrivacyMode: privacy,
      })
      expect(wrappedOutput).toEqual(nativeOutput)
      expect(request).toEqual(original)
      expect(requests).toHaveLength(recording ? 1 : 2)
      if (!recording) expect(requests[1]).toEqual(requests[0])
      expect(JSON.stringify(requests[0])).toContain(body)
      await replay?.finish()
      await vi.waitFor(() => expect(collector.events).toHaveLength(1), { timeout: 2000 })
      collector.verify()
      const properties = collector.events[0].properties as any
      expect(properties).toMatchObject({ $ai_input_tokens: 7, $ai_output_tokens: 2, $ai_trace_id: 'tool-result-trace' })
      if (privacy) {
        expect(properties.$ai_input).toBeNull()
        expect(properties.$ai_output_choices).toBeNull()
      } else if (provider === 'gemini') {
        expect(properties.$ai_input[1]).toEqual({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'call_1', content: { body: capped, summary } }],
        })
      } else if (provider === 'openai-chat') {
        expect(properties.$ai_input[1]).toEqual({
          role: 'tool',
          tool_call_id: 'call_1',
          content: [
            { type: 'text', text: capped },
            { type: 'text', text: summary },
          ],
        })
      } else if (provider === 'openai-responses') {
        expect(properties.$ai_input[1].role).toBe('user')
        expect(JSON.parse(properties.$ai_input[1].content)).toEqual({
          type: 'function_call_output',
          call_id: 'call_1',
          output: [
            { type: 'input_text', text: capped },
            { type: 'input_text', text: summary },
          ],
        })
      } else {
        expect(properties.$ai_input[1]).toEqual({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call_1',
              is_error: true,
              content: [
                { type: 'text', text: capped },
                { type: 'text', text: summary },
              ],
            },
          ],
        })
      }
    } finally {
      await posthog.shutdown()
      await replay?.close()
      await recording?.close()
      upstream.closeAllConnections()
      await new Promise<void>((resolve) => upstream.close(() => resolve()))
      await collector.close()
      await rm(directory, { recursive: true, force: true })
    }
  }
)
