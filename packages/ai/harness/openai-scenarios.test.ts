import { describe, expect, it, vi } from 'vitest'
import { executeOpenAIScenario, openAIScenarios, verifyOpenAIRecording } from './openai-scenarios.mjs'

const expectedNames = [
  'chat-text',
  'chat-stream',
  'chat-tools',
  'chat-stream-tools',
  'chat-structured',
  'chat-cache',
  'chat-length',
  'responses-text',
  'responses-stream',
  'responses-tools',
  'responses-stream-tools',
  'responses-structured',
  'responses-reasoning',
  'responses-cache-write',
  'responses-incomplete',
  'embeddings',
  'transcription-json',
  'transcription-text',
  'transcription-stream',
  'transcription-verbose',
  'transcription-srt',
  'transcription-vtt',
  'background-complete',
  'background-cancel',
].map((name) => `openai-${name}`)

const usage = { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 }
const completion = {
  object: 'chat.completion',
  model: 'synthetic-model',
  usage,
  choices: [{ index: 0, message: { role: 'assistant', content: 'Hello.' }, finish_reason: 'stop' }],
}
const response = {
  object: 'response',
  model: 'synthetic-model',
  status: 'completed',
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello.' }] }],
  usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10, output_tokens_details: { reasoning_tokens: 0 } },
}

describe('OpenAI recording scenarios', () => {
  it('covers each instrumented OpenAI operation without silently skipping a scenario', () => {
    const names = openAIScenarios.map((scenario) => scenario.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toEqual(expect.arrayContaining(expectedNames))
    expect(new Set(openAIScenarios.map((scenario) => scenario.operation))).toEqual(
      new Set([
        'chat.create',
        'chat.parse',
        'responses.create',
        'responses.parse',
        'embeddings.create',
        'audio.transcriptions.create',
        'responses.background.poll',
        'responses.background.cancel',
      ])
    )
  })

  it('only enables response storage where background lifecycle tests need it', () => {
    for (const scenario of openAIScenarios) {
      if (['chat.create', 'chat.parse', 'responses.create', 'responses.parse'].includes(scenario.operation)) {
        expect(scenario.request.store, scenario.name).toBe(false)
      }
      if (scenario.operation.startsWith('responses.background.')) {
        expect(scenario.request.background, scenario.name).toBe(true)
        expect(scenario.request.store, scenario.name).toBe(true)
      }
    }
    expect(JSON.stringify(openAIScenarios)).not.toMatch(/sk-proj-|Bearer\s|api[_-]?key/i)
  })

  it('accepts a successful recording with measured usage', () => {
    const scenario = {
      name: 'synthetic-chat',
      operation: 'chat.create',
      request: {},
      expected: { text: 'Hello.', finishReason: 'stop' },
    }
    expect(() => verifyOpenAIRecording(scenario, [completion])).not.toThrow()
    expect(() => verifyOpenAIRecording(scenario, [{ ...completion, usage: undefined }])).toThrow()
  })

  const toolScenario = {
    name: 'synthetic-tools',
    operation: 'chat.create',
    request: {},
    expected: { name: 'get_weather', cities: ['Paris'], finishReason: 'tool_calls' },
  }
  const toolCompletion = {
    ...completion,
    choices: [
      {
        index: 0,
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_synthetic',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
            },
          ],
        },
      },
    ],
  }
  it('checks actual tool output instead of accepting a text response to a forced tool request', () => {
    expect(() => verifyOpenAIRecording(toolScenario, [toolCompletion])).not.toThrow()
    expect(() => verifyOpenAIRecording(toolScenario, [completion])).toThrow()
  })
  it.each([
    { name: 'different_tool', arguments: '{"city":"Paris"}' },
    { name: 'get_weather', arguments: '{"city":"London"}' },
    { name: 'get_weather', arguments: '{"city":' },
  ])('rejects a wrong tool name or arguments: %j', (fn) => {
    const changed = structuredClone(toolCompletion)
    changed.choices[0].message.tool_calls[0].function = fn
    expect(() => verifyOpenAIRecording(toolScenario, [changed])).toThrow()
  })
  it('does not label a zero-cache recording as a cache hit', () => {
    const scenario = {
      name: 'synthetic-cache',
      operation: 'chat.create',
      request: {},
      expected: { cacheHit: true, finishReason: 'stop' },
    }
    const hit = { ...completion, usage: { ...usage, prompt_tokens_details: { cached_tokens: 4 } } }
    expect(() => verifyOpenAIRecording(scenario, [completion, hit])).not.toThrow()
    expect(() => verifyOpenAIRecording(scenario, [completion, completion])).toThrow()
  })
  it('does not claim reasoning coverage without reasoning tokens', () => {
    const scenario = {
      name: 'synthetic-reasoning',
      operation: 'responses.create',
      request: {},
      expected: { reasoning: true, status: 'completed' },
    }
    const measured = { ...response, usage: { ...response.usage, output_tokens_details: { reasoning_tokens: 2 } } }
    expect(() => verifyOpenAIRecording(scenario, [measured])).not.toThrow()
    expect(() => verifyOpenAIRecording(scenario, [response])).toThrow()
  })
  it('requires measured cache writes as well as cache reads for the cache-write scenario', () => {
    const scenario = {
      name: 'synthetic-cache-write',
      operation: 'responses.create',
      request: {},
      expected: { cacheWrite: true, cacheHit: true, status: 'completed' },
    }
    const write = {
      ...response,
      usage: { ...response.usage, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 5 } },
    }
    const hit = {
      ...response,
      usage: { ...response.usage, input_tokens_details: { cached_tokens: 5, cache_write_tokens: 0 } },
    }
    expect(() => verifyOpenAIRecording(scenario, [write, hit])).not.toThrow()
    expect(() => verifyOpenAIRecording(scenario, [response, hit])).toThrow()
    expect(() => verifyOpenAIRecording(scenario, [write, response])).toThrow()
  })
  it('distinguishes an intentional token limit from a successful complete response', () => {
    const scenario = {
      name: 'synthetic-incomplete',
      operation: 'responses.create',
      request: {},
      expected: { status: 'incomplete', finishReason: 'max_output_tokens' },
    }
    const incomplete = { ...response, status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }
    expect(() => verifyOpenAIRecording(scenario, [incomplete])).not.toThrow()
    expect(() => verifyOpenAIRecording(scenario, [response])).toThrow()
  })
  it('requires the Chat parse helper to return the parsed value, not only valid JSON text', () => {
    const scenario = {
      name: 'synthetic-chat-parse',
      operation: 'chat.parse',
      request: {},
      expected: { structuredCity: 'Paris', finishReason: 'stop' },
    }
    const raw = {
      ...completion,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"city":"Paris"}' } }],
    }
    const parsed = {
      ...raw,
      choices: [{ ...raw.choices[0], message: { ...raw.choices[0].message, parsed: { city: 'Paris' } } }],
    }
    expect(() => verifyOpenAIRecording(scenario, [parsed])).not.toThrow()
    expect(() => verifyOpenAIRecording(scenario, [raw])).toThrow()
  })
  it('requires the Responses parse helper to return output_parsed', () => {
    const scenario = {
      name: 'synthetic-responses-parse',
      operation: 'responses.parse',
      request: {},
      expected: { structuredCity: 'Paris', status: 'completed' },
    }
    const raw = {
      ...response,
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"city":"Paris"}' }] }],
    }
    expect(() => verifyOpenAIRecording(scenario, [{ ...raw, output_parsed: { city: 'Paris' } }])).not.toThrow()
    expect(() => verifyOpenAIRecording(scenario, [raw])).toThrow()
  })
})

describe('OpenAI recording request limits', () => {
  it.each(['openai-chat-cache', 'openai-responses-cache-write'])(
    'bounds unsuccessful cache recording: %s',
    async (name) => {
      const scenario = openAIScenarios.find((item) => item.name === name)!
      const create = vi.fn().mockResolvedValue(name === 'openai-chat-cache' ? completion : response)
      const client = { chat: { completions: { create } }, responses: { create } }
      const results = await executeOpenAIScenario(client, scenario, { pollIntervalMs: 0 })
      expect(create).toHaveBeenCalledTimes(4)
      expect(results).toHaveLength(4)
      expect(() => verifyOpenAIRecording(scenario, results)).toThrow()
    }
  )

  it('stops cache recording when both native counters have been measured', async () => {
    const scenario = openAIScenarios.find((item) => item.name === 'openai-responses-cache-write')!
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        ...response,
        usage: { ...response.usage, input_tokens_details: { cache_write_tokens: 5, cached_tokens: 0 } },
      })
      .mockResolvedValue({
        ...response,
        usage: { ...response.usage, input_tokens_details: { cache_write_tokens: 0, cached_tokens: 5 } },
      })
    const results = await executeOpenAIScenario({ responses: { create } }, scenario, { pollIntervalMs: 0 })
    expect(create).toHaveBeenCalledTimes(2)
    expect(() => verifyOpenAIRecording(scenario, results)).not.toThrow()
  })

  it('stops a pending background recording after ten polls', async () => {
    const scenario = openAIScenarios.find((item) => item.name === 'openai-background-complete')!
    const pending = { id: 'resp_synthetic', status: 'in_progress' }
    const create = vi.fn().mockResolvedValue(pending)
    const retrieve = vi.fn().mockResolvedValue(pending)
    const onCreatedResponse = vi.fn()
    await expect(
      executeOpenAIScenario({ responses: { create, retrieve } }, scenario, {
        pollIntervalMs: 0,
        onCreatedResponse,
      })
    ).rejects.toThrow('Background response did not finish')
    expect(create).toHaveBeenCalledTimes(1)
    expect(retrieve).toHaveBeenCalledTimes(10)
    expect(onCreatedResponse).toHaveBeenCalledTimes(1)
    expect(onCreatedResponse).toHaveBeenCalledWith('resp_synthetic')
  })

  it('records one repeated terminal poll without continuing the polling loop', async () => {
    const scenario = openAIScenarios.find((item) => item.name === 'openai-background-complete')!
    const create = vi.fn().mockResolvedValue({ id: 'resp_synthetic', status: 'queued' })
    const retrieve = vi.fn().mockResolvedValue({ ...response, id: 'resp_synthetic' })
    const results = await executeOpenAIScenario({ responses: { create, retrieve } }, scenario, { pollIntervalMs: 0 })
    expect(create).toHaveBeenCalledTimes(1)
    expect(retrieve).toHaveBeenCalledTimes(2)
    expect(results.map((item) => item.status)).toEqual(['queued', 'completed', 'completed'])
  })

  it('registers the created response for cleanup before a poll can fail', async () => {
    const scenario = openAIScenarios.find((item) => item.name === 'openai-background-complete')!
    const observed: string[] = []
    const client = {
      responses: {
        create: vi.fn().mockResolvedValue({ id: 'resp_synthetic', status: 'queued' }),
        retrieve: vi.fn().mockImplementation(() => {
          observed.push('poll')
          throw new Error('Synthetic polling failure')
        }),
      },
    }
    await expect(
      executeOpenAIScenario(client, scenario, {
        pollIntervalMs: 0,
        onCreatedResponse(id: string) {
          observed.push(id)
        },
      })
    ).rejects.toThrow('Synthetic polling failure')
    expect(observed).toEqual(['resp_synthetic', 'poll'])
  })
})
