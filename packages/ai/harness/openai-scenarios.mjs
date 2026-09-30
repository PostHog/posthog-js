import { readFile } from 'node:fs/promises'
import { toFile } from 'openai'

const chatModel = 'gpt-4.1-mini-2025-04-14'
const reasoningModel = 'gpt-5-mini-2025-08-07'
const citySchema = {
  type: 'object',
  properties: { city: { type: 'string' } },
  required: ['city'],
  additionalProperties: false,
}
const functionDefinition = { name: 'get_weather', parameters: citySchema, strict: true }
const greeting = 'Hello from the cassette test.'
const chat = { model: chatModel, store: false, max_completion_tokens: 128, temperature: 0 }
const responses = { model: chatModel, store: false, max_output_tokens: 128 }
const chatText = { ...chat, messages: [{ role: 'user', content: `Reply with exactly: ${greeting}` }] }
const responseText = { ...responses, input: `Reply with exactly: ${greeting}` }
const chatTools = {
  ...chat,
  messages: [{ role: 'user', content: 'Call get_weather for Paris. Do not answer with text.' }],
  tools: [{ type: 'function', function: functionDefinition }],
  tool_choice: { type: 'function', function: { name: 'get_weather' } },
}
const responseTools = {
  ...responses,
  input: 'Call get_weather for Paris. Do not answer with text.',
  tools: [{ type: 'function', ...functionDefinition }],
  tool_choice: { type: 'function', name: 'get_weather' },
}
const background = {
  model: reasoningModel,
  input: 'What is 17 times 23? Reply with only the result.',
  reasoning: { effort: 'low' },
  max_output_tokens: 1024,
  background: true,
  store: true,
}
const scenario = (name, operation, request, expected) => ({ name: `openai-${name}`, operation, request, expected })

export const openAIScenarios = [
  scenario('chat-text', 'chat.create', chatText, { text: greeting, finishReason: 'stop' }),
  scenario(
    'chat-stream',
    'chat.create',
    { ...chatText, stream: true, stream_options: { include_usage: true } },
    {
      text: greeting,
      finishReason: 'stop',
    }
  ),
  scenario('chat-tools', 'chat.create', chatTools, {
    name: 'get_weather',
    cities: ['Paris'],
    finishReason: 'stop',
  }),
  scenario(
    'chat-stream-tools',
    'chat.create',
    {
      ...chatTools,
      messages: [
        { role: 'user', content: 'Call get_weather once for Paris and once for Oslo. Do not answer with text.' },
      ],
      tool_choice: 'required',
      parallel_tool_calls: true,
      max_completion_tokens: 256,
      stream: true,
      stream_options: { include_usage: true },
    },
    { name: 'get_weather', cities: ['Paris', 'Oslo'], finishReason: 'tool_calls' }
  ),
  scenario(
    'chat-structured',
    'chat.parse',
    {
      ...chat,
      messages: [{ role: 'user', content: 'Return the city Paris.' }],
      response_format: { type: 'json_schema', json_schema: { name: 'city', strict: true, schema: citySchema } },
    },
    { structuredCity: 'Paris', finishReason: 'stop' }
  ),
  scenario(
    'chat-cache',
    'chat.create',
    {
      ...chat,
      max_completion_tokens: 16,
      prompt_cache_key: 'posthog-cassette-cache',
      messages: [
        {
          role: 'system',
          content: Array.from(
            { length: 160 },
            (_, i) => `Test record ${i}: The weather in Paris is sunny and the weather in Oslo is cloudy.`
          ).join('\n'),
        },
        { role: 'user', content: 'Reply with exactly OK.' },
      ],
    },
    { cacheHit: true, finishReason: 'stop' }
  ),
  scenario(
    'chat-length',
    'chat.create',
    {
      ...chat,
      max_completion_tokens: 1,
      messages: [{ role: 'user', content: 'Count from one to one hundred, spelling out each number.' }],
    },
    { finishReason: 'length' }
  ),
  scenario('responses-text', 'responses.create', responseText, { text: greeting, status: 'completed' }),
  scenario(
    'responses-stream',
    'responses.create',
    { ...responseText, stream: true },
    { text: greeting, status: 'completed' }
  ),
  scenario('responses-tools', 'responses.create', responseTools, {
    name: 'get_weather',
    cities: ['Paris'],
    status: 'completed',
  }),
  scenario(
    'responses-stream-tools',
    'responses.create',
    { ...responseTools, stream: true },
    {
      name: 'get_weather',
      cities: ['Paris'],
      status: 'completed',
    }
  ),
  scenario(
    'responses-structured',
    'responses.parse',
    {
      ...responses,
      input: 'Return the city Paris.',
      text: { format: { type: 'json_schema', name: 'city', strict: true, schema: citySchema } },
    },
    { structuredCity: 'Paris', status: 'completed' }
  ),
  scenario(
    'responses-reasoning',
    'responses.create',
    {
      ...responses,
      model: reasoningModel,
      input:
        'Among integers from 1 through 1000, count those divisible by 7 but not by 5, and find their sum. Reply only as count,sum without spaces.',
      reasoning: { effort: 'medium' },
      max_output_tokens: 1024,
    },
    { text: '114,56861', reasoning: true, status: 'completed' }
  ),
  scenario(
    'responses-cache-write',
    'responses.create',
    {
      model: 'gpt-5.6-luna',
      store: false,
      max_output_tokens: 32,
      reasoning: { effort: 'none' },
      prompt_cache_options: { mode: 'explicit', ttl: '30m' },
      prompt_cache_key: 'posthog-cassette-cache-write',
      input: [
        {
          role: 'developer',
          content: [
            {
              type: 'input_text',
              text: Array.from(
                { length: 100 },
                (_, i) => `Test record ${i}: The weather in Paris is sunny and the weather in Oslo is cloudy.`
              ).join('\n'),
              prompt_cache_breakpoint: { mode: 'explicit' },
            },
          ],
        },
        { role: 'user', content: 'Reply with exactly OK.' },
      ],
    },
    { cacheWrite: true, cacheHit: true, status: 'completed' }
  ),
  scenario(
    'responses-incomplete',
    'responses.create',
    {
      ...responses,
      input: 'Count from one to one hundred, spelling out each number.',
      max_output_tokens: 16,
    },
    { status: 'incomplete', finishReason: 'max_output_tokens' }
  ),
  scenario(
    'embeddings',
    'embeddings.create',
    {
      model: 'text-embedding-3-small',
      input: greeting,
      dimensions: 8,
      encoding_format: 'float',
    },
    { dimensions: 8 }
  ),
  ...['json', 'text', 'stream', 'verbose', 'srt', 'vtt'].map((format) =>
    scenario(
      `transcription-${format}`,
      'audio.transcriptions.create',
      {
        model: ['json', 'stream'].includes(format) ? 'gpt-4o-mini-transcribe-2025-12-15' : 'whisper-1',
        response_format: format === 'stream' ? 'json' : format === 'verbose' ? 'verbose_json' : format,
        ...(format === 'stream' ? { stream: true } : {}),
        language: 'en',
      },
      { transcript: 'The weather in Paris is sunny.', analytics: !['text', 'srt', 'vtt'].includes(format) }
    )
  ),
  scenario('background-complete', 'responses.background.poll', background, { status: 'completed', text: '391' }),
  scenario(
    'background-cancel',
    'responses.background.cancel',
    {
      ...background,
      input: 'List the first one hundred prime numbers and explain how to check each one.',
    },
    { status: 'cancelled' }
  ),
]

const terminalStatuses = new Set(['completed', 'failed', 'incomplete', 'cancelled'])
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export async function executeOpenAIScenario(client, scenario, options = {}) {
  const request = { ...scenario.request, ...options.monitoring }
  const results = []
  async function consume(promise) {
    const wrapped = options.helper === 'withResponse' && typeof promise.withResponse === 'function'
    const response = wrapped ? await promise.withResponse() : undefined
    const result = wrapped ? response.data : await promise
    if (wrapped) options.onHelper?.({ requestId: response.request_id, status: response.response.status })
    if (result && Symbol.asyncIterator in Object(result)) {
      const events = []
      for await (const event of result) {
        events.push(event)
        options.onEvent?.(event)
      }
      results.push(events)
      return events
    }
    results.push(result)
    options.onCall?.(result)
    return result
  }
  if (scenario.operation === 'chat.create') {
    for (let attempt = 0; attempt < (scenario.expected.cacheHit ? 4 : 1); attempt++) {
      const result = await consume(client.chat.completions.create(request))
      if (!scenario.expected.cacheHit || result.usage?.prompt_tokens_details?.cached_tokens > 0) break
      if (attempt < 3) await delay(options.pollIntervalMs ?? 2000)
    }
  } else if (scenario.operation === 'chat.parse') {
    await consume(client.chat.completions.parse(request))
  } else if (scenario.operation === 'responses.create') {
    if (options.helper === 'stream') {
      const stream = client.responses.stream(request)
      await consume(stream)
      options.onHelper?.(await stream.finalResponse())
    } else {
      for (let attempt = 0; attempt < (scenario.expected.cacheHit ? 4 : 1); attempt++) {
        await consume(client.responses.create(request))
        if (!scenario.expected.cacheHit) break
        const hasRead = results.some((result) => result.usage?.input_tokens_details?.cached_tokens > 0)
        const hasWrite = results.some((result) => result.usage?.input_tokens_details?.cache_write_tokens > 0)
        if (hasRead && (!scenario.expected.cacheWrite || hasWrite)) break
        if (attempt < 3) await delay(options.pollIntervalMs ?? 2000)
      }
    }
  } else if (scenario.operation === 'responses.parse') {
    await consume(client.responses.parse(request))
  } else if (scenario.operation.startsWith('responses.background.')) {
    let result = await consume(client.responses.create(request))
    options.onCreatedResponse?.(result.id)
    if (scenario.operation === 'responses.background.cancel') {
      await consume(client.responses.cancel(result.id))
    } else {
      for (let attempt = 0; attempt < 10 && !terminalStatuses.has(result.status); attempt++) {
        await delay(options.pollIntervalMs ?? 2000)
        result = await consume(client.responses.retrieve(result.id))
      }
      if (!terminalStatuses.has(result.status))
        throw new Error('Background response did not finish within the recording limit')
      await consume(client.responses.retrieve(result.id))
    }
  } else if (scenario.operation === 'embeddings.create') {
    await consume(client.embeddings.create(request))
  } else if (scenario.operation === 'audio.transcriptions.create') {
    const audio = await readFile(new URL('./fixtures/openai-audio.wav', import.meta.url))
    const file = await toFile(audio, 'openai-audio.wav', { type: 'audio/wav' })
    await consume(client.audio.transcriptions.create({ ...request, file }))
  } else {
    throw new Error('Unknown OpenAI recording operation')
  }
  return results
}

function assert(condition) {
  if (!condition) throw new Error('OpenAI response did not satisfy the recording scenario')
}

function chatResult(result) {
  if (!Array.isArray(result)) return result
  const tools = new Map()
  let text = ''
  let finishReason
  let usage
  for (const event of result) {
    usage = event.usage ?? usage
    const choice = event.choices?.[0]
    text += choice?.delta?.content ?? ''
    finishReason = choice?.finish_reason ?? finishReason
    for (const item of choice?.delta?.tool_calls ?? []) {
      const current = tools.get(item.index) ?? { id: '', function: { name: '', arguments: '' } }
      current.id = item.id ?? current.id
      current.function.name = item.function?.name ?? current.function.name
      current.function.arguments += item.function?.arguments ?? ''
      tools.set(item.index, current)
    }
  }
  return {
    usage,
    choices: [{ finish_reason: finishReason, message: { content: text, tool_calls: [...tools.values()] } }],
  }
}

function responseResult(result) {
  if (!Array.isArray(result)) return result
  return result.findLast((event) => event.response && terminalStatuses.has(event.response.status))?.response
}

function checkUsage(usage, inputField, outputField) {
  assert(usage && Number.isInteger(usage[inputField]) && usage[inputField] >= 0)
  if (outputField) assert(Number.isInteger(usage[outputField]) && usage[outputField] >= 0)
}

function checkTools(tools, expected) {
  assert(tools.length === expected.cities.length)
  assert(new Set(tools.map((tool) => tool.id)).size === tools.length)
  const cities = tools.map((tool) => {
    assert(typeof tool.id === 'string' && tool.id.length > 0 && tool.function.name === expected.name)
    const args = JSON.parse(tool.function.arguments)
    assert(args && !Array.isArray(args) && Object.keys(args).length === 1 && typeof args.city === 'string')
    return args.city
  })
  assert(JSON.stringify(cities.sort()) === JSON.stringify([...expected.cities].sort()))
}

export function verifyOpenAIRecording(scenario, results) {
  assert(Array.isArray(results) && results.length > 0)
  const expected = scenario.expected
  const last = results.at(-1)
  if (scenario.operation.startsWith('chat.')) {
    const completions = results.map(chatResult)
    for (const result of completions) {
      checkUsage(result.usage, 'prompt_tokens', 'completion_tokens')
      assert(result.choices?.[0]?.finish_reason === expected.finishReason)
    }
    const message = completions.at(-1).choices[0].message
    if (expected.text) assert(message.content?.trim() === expected.text)
    if (expected.structuredCity) {
      assert(JSON.parse(message.content).city === expected.structuredCity)
      if (scenario.operation === 'chat.parse') assert(message.parsed?.city === expected.structuredCity)
    }
    if (expected.name) checkTools(message.tool_calls ?? [], expected)
    if (expected.cacheHit) assert(completions.some((result) => result.usage.prompt_tokens_details?.cached_tokens > 0))
  } else if (scenario.operation.startsWith('responses.')) {
    const result = responseResult(last)
    assert(result && result.status === expected.status)
    if (expected.status !== 'cancelled') checkUsage(result.usage, 'input_tokens', 'output_tokens')
    if (expected.finishReason) assert(result.incomplete_details?.reason === expected.finishReason)
    const text = (result.output ?? [])
      .flatMap((item) => item.content ?? [])
      .map((part) => part.text ?? '')
      .join('')
    if (expected.text) assert(text.trim() === expected.text)
    if (expected.structuredCity) {
      assert(JSON.parse(text).city === expected.structuredCity)
      if (scenario.operation === 'responses.parse') assert(result.output_parsed?.city === expected.structuredCity)
    }
    if (expected.reasoning) assert(result.usage.output_tokens_details?.reasoning_tokens > 0)
    if (expected.cacheHit) assert(results.some((item) => item.usage?.input_tokens_details?.cached_tokens > 0))
    if (expected.cacheWrite) assert(results.some((item) => item.usage?.input_tokens_details?.cache_write_tokens > 0))
    if (expected.name)
      checkTools(
        result.output
          .filter((item) => item.type === 'function_call')
          .map((item) => ({
            id: item.call_id,
            function: { name: item.name, arguments: item.arguments },
          })),
        expected
      )
    if (scenario.operation.startsWith('responses.background.')) {
      assert(results.length > 1 && ['queued', 'in_progress'].includes(results[0].status))
      assert(results.every((item) => item.id === results[0].id))
    }
  } else if (scenario.operation === 'embeddings.create') {
    checkUsage(last.usage, 'prompt_tokens')
    assert(last.data?.length === 1 && last.data[0].embedding?.length === expected.dimensions)
    assert(last.data[0].embedding.every(Number.isFinite))
  } else if (scenario.operation === 'audio.transcriptions.create') {
    const result = Array.isArray(last) ? last.find((event) => event.type === 'transcript.text.done') : last
    const text = typeof result === 'string' ? result : result?.text
    assert(typeof text === 'string' && text.includes(expected.transcript))
    if (scenario.request.model !== 'whisper-1') checkUsage(result.usage, 'input_tokens', 'output_tokens')
  } else {
    throw new Error('Unknown OpenAI recording operation')
  }
}
