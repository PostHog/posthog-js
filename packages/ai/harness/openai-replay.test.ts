import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { startReplay } from './cassette'
import { startCollector } from './collector'

type Counts = readonly [
  input: number,
  output: number | undefined,
  cacheRead: number,
  cacheWrite: number,
  reasoning: number,
]
type Case = { name: string; counts: readonly Counts[]; stop?: string; text?: string; embedding?: boolean }
const greeting = 'Hello from the cassette test.'
// Literal expectations independently read from the provider recordings, not wrapper output.
const cases: Case[] = [
  { name: 'chat-text', counts: [[17, 6, 0, 0, 0]], stop: 'stop', text: greeting },
  { name: 'chat-stream', counts: [[17, 6, 0, 0, 0]], stop: 'stop', text: greeting },
  { name: 'chat-tools', counts: [[58, 5, 0, 0, 0]], stop: 'stop' },
  { name: 'chat-stream-tools', counts: [[54, 45, 0, 0, 0]], stop: 'tool_calls' },
  { name: 'chat-structured', counts: [[40, 5, 0, 0, 0]], stop: 'stop', text: '{"city":"Paris"}' },
  {
    name: 'chat-cache',
    counts: [
      [3082, 1, 0, 0, 0],
      [3082, 1, 2944, 0, 0],
    ],
    stop: 'stop',
    text: 'OK',
  },
  { name: 'chat-length', counts: [[19, 1, 0, 0, 0]], stop: 'length', text: 'Sure' },
  { name: 'responses-text', counts: [[17, 7, 0, 0, 0]], stop: 'completed', text: greeting },
  { name: 'responses-stream', counts: [[17, 7, 0, 0, 0]], stop: 'completed', text: greeting },
  { name: 'responses-tools', counts: [[52, 6, 0, 0, 0]], stop: 'completed' },
  { name: 'responses-stream-tools', counts: [[52, 6, 0, 0, 0]], stop: 'completed' },
  { name: 'responses-structured', counts: [[34, 6, 0, 0, 0]], stop: 'completed', text: '{"city":"Paris"}' },
  { name: 'responses-incomplete', counts: [[19, 16, 0, 0, 0]], stop: 'max_output_tokens' },
  { name: 'responses-reasoning', counts: [[41, 648, 0, 0, 576]], stop: 'completed', text: '114,56861' },
  {
    name: 'responses-cache-write',
    counts: [
      [1942, 5, 0, 1930, 0],
      [1942, 5, 1930, 0, 0],
    ],
    stop: 'completed',
    text: 'OK',
  },
  { name: 'embeddings', counts: [[6, undefined, 0, 0, 0]], embedding: true },
  { name: 'transcription-json', counts: [[18, 9, 0, 0, 0]] },
  { name: 'transcription-stream', counts: [[18, 9, 0, 0, 0]] },
  { name: 'transcription-verbose', counts: [[0, 0, 0, 0, 0]] },
  { name: 'transcription-text', counts: [] },
  { name: 'transcription-srt', counts: [] },
  { name: 'transcription-vtt', counts: [] },
  { name: 'background-complete', counts: [[20, 36, 0, 0, 0]], stop: 'completed', text: '391' },
  { name: 'background-cancel', counts: [[0, 0, 0, 0, 0]], stop: 'cancelled' },
]

function providerResult(interaction) {
  const body = interaction.response.body
  if (body.kind === 'json') return body.value
  if (body.kind === 'text') return body.text
  return body.chunks.flatMap((chunk) =>
    chunk
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter((data) => data !== '[DONE]')
      .map(JSON.parse)
  )
}

function terminalResult(result) {
  if (!Array.isArray(result)) return result
  return result.findLast((event) => event.response)?.response ?? result.findLast((event) => event.usage)
}

async function run(name: string, environment: Record<string, string> = {}) {
  const path = fileURLToPath(new URL(`./fixtures/openai-${name}.json`, import.meta.url))
  const cassette = JSON.parse(await readFile(path, 'utf8'))
  const request = cassette.interactions[0].request.body
  // Multipart boundaries vary. The scenario supplies the committed artificial audio file.
  const options = request.fields
    ? Object.fromEntries(
        request.fields.map(([key, value]) => [key, value === 'true' ? true : value === 'false' ? false : value])
      )
    : request
  const replay = await startReplay({ path })
  const collector = await startCollector()
  try {
    const execution = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('./scenarios/openai.mjs', import.meta.url))],
      {
        env: {
          PROVIDER_URL: replay.url,
          COLLECTOR_URL: collector.url,
          SCENARIO: `openai-${name}`,
          REQUEST: JSON.stringify(options),
          ...environment,
        },
        timeout: 10000,
        maxBuffer: 2 * 1024 * 1024,
      }
    )
    await replay.finish()
    collector.verify()
    return { caller: JSON.parse(execution.stdout), events: collector.events, cassette }
  } finally {
    await replay.close()
    await collector.close()
  }
}

it.each(cases)('preserves provider responses and emitted analytics for $name', async (scenario) => {
  const { caller, events, cassette } = await run(scenario.name)
  const recorded = cassette.interactions.map(providerResult)
  expect(caller.results).toHaveLength(recorded.length)
  for (let index = 0; index < recorded.length; index++) {
    if (typeof recorded[index] === 'string') expect(caller.results[index]).toBe(recorded[index])
    else expect(caller.results[index]).toMatchObject(recorded[index])
  }
  expect(events).toHaveLength(scenario.counts.length)
  for (const [index, [input, output, cacheRead, cacheWrite, reasoning]] of scenario.counts.entries()) {
    const event = events[index]
    const properties = event.properties
    expect(event).toMatchObject({
      event: scenario.embedding ? '$ai_embedding' : '$ai_generation',
      distinct_id: 'cassette-test',
      properties: {
        $ai_provider: 'openai',
        $ai_input_tokens: input,
        $ai_http_status: 200,
        $ai_cache_reporting_exclusive: false,
      },
    })
    expect(properties.$ai_output_tokens).toBe(output)
    expect(properties.$ai_cache_read_input_tokens).toBe(cacheRead || undefined)
    expect(properties.$ai_cache_creation_input_tokens).toBe(cacheWrite || undefined)
    expect(properties.$ai_reasoning_tokens).toBe(reasoning || undefined)
    expect(properties.$ai_stop_reason).toBe(scenario.stop)
    const provider = terminalResult(recorded[scenario.name.startsWith('background-') ? recorded.length - 1 : index])
    expect(properties.$ai_usage).toEqual(provider?.usage ?? undefined)
    expect(properties.$ai_model).toBe(
      provider?.model ??
        cassette.interactions[0].request.body.fields?.find(([key]) => key === 'model')?.[1] ??
        cassette.interactions[0].request.body.model
    )
    // Existing contract: Responses streaming and parse preserve provider-shaped output.
    // Nonstreaming create formats assistant content. Assert both forms explicitly.
    if (scenario.name.startsWith('responses-stream')) expect(properties.$ai_output_choices).toEqual(provider.output)
    else if (scenario.name === 'responses-structured')
      expect(properties.$ai_output_choices).toEqual(caller.results[0].output)
    else if (scenario.text)
      expect(properties.$ai_output_choices).toEqual([
        { role: 'assistant', content: [{ type: 'text', text: scenario.text }] },
      ])
    if (scenario.name.includes('stream')) {
      expect(Number.isFinite(properties.$ai_time_to_first_token)).toBe(true)
      expect(properties.$ai_time_to_first_token).toBeGreaterThanOrEqual(0)
    }
    if (cassette.interactions[0].request.body.tools)
      expect(properties.$ai_tools).toEqual(cassette.interactions[0].request.body.tools)
    if (scenario.embedding) {
      expect(properties.$ai_output_choices).toBeNull()
      expect(JSON.stringify(event)).not.toContain(JSON.stringify(provider.data[0].embedding))
    }
  }
  if (scenario.name === 'chat-structured')
    expect(caller.results[0].choices[0].message.parsed).toEqual({ city: 'Paris' })
  if (scenario.name === 'responses-structured') expect(caller.results[0].output_parsed).toEqual({ city: 'Paris' })
  if (scenario.name.startsWith('background-')) {
    expect(caller.results[0].status).toBe('queued')
    expect(new Set(caller.results.map((result) => result.id)).size).toBe(1)
    if (scenario.name === 'background-complete') expect(caller.results.at(-1)).toEqual(caller.results.at(-2))
  }
})

it('captures the forced nonstreaming Chat tool without changing its provider stop reason', async () => {
  const { events } = await run('chat-tools')
  expect(events[0].properties).toMatchObject({
    $ai_stop_reason: 'stop',
    $ai_output_choices: [
      {
        role: 'assistant',
        content: [
          {
            type: 'function',
            id: 'call_JG152OhuoIOXkRDlugUJEW4S',
            function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
          },
        ],
      },
    ],
  })
})

it('keeps both streamed Chat tool calls separate with their provider IDs and arguments', async () => {
  const { events } = await run('chat-stream-tools')
  expect(events[0].properties.$ai_output_choices).toEqual([
    {
      role: 'assistant',
      content: [
        {
          type: 'function',
          id: 'call_HiEz8gicsQoMbTcAhTXtscAI',
          function: { name: 'get_weather', arguments: '{"city": "Paris"}' },
        },
        {
          type: 'function',
          id: 'call_NnT5tTCaKSV7JIxkEO3sfNuc',
          function: { name: 'get_weather', arguments: '{"city": "Oslo"}' },
        },
      ],
    },
  ])
})

it.each([
  ['responses-tools', 'call_r5aXzEBOBhrkxUfpqWfQlwB4'],
  ['responses-stream-tools', 'call_qYSzsp0tya92RyVyMOVQRezA'],
])('keeps the Responses tool call from %s', async (name, id) => {
  const { events } = await run(name)
  if (name === 'responses-stream-tools') {
    expect(events[0].properties.$ai_output_choices).toEqual([
      {
        type: 'function_call',
        id: 'fc_00330f4b7593f812016aaf408776dc87d2a1db300f7fddf2d4',
        status: 'completed',
        call_id: id,
        name: 'get_weather',
        arguments: '{"city":"Paris"}',
      },
    ])
    return
  }
  expect(events[0].properties.$ai_output_choices).toEqual([
    {
      role: 'assistant',
      content: [{ type: 'function', id, function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }],
    },
  ])
})

it.each(['chat-text', 'chat-stream', 'responses-text', 'responses-stream', 'embeddings', 'transcription-json'])(
  'redacts %s analytics without changing caller data or usage',
  async (name) => {
    const { caller, events, cassette } = await run(name, {
      MONITORING: JSON.stringify({ posthogDistinctId: 'privacy-test', posthogPrivacyMode: true }),
    })
    expect(caller.results[0]).toMatchObject(providerResult(cassette.interactions[0]))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      distinct_id: 'privacy-test',
      properties: { $ai_input: null, $ai_output_choices: null },
    })
    expect(events[0].properties.$ai_input_tokens).toBeGreaterThan(0)
    expect(events[0].properties.$ai_usage).toBeDefined()
    expect(JSON.stringify(events)).not.toContain(
      name.startsWith('transcription-') ? 'The weather in Paris is sunny.' : greeting
    )
  }
)

it('preserves identity, tracing, groups and custom properties without sending them to OpenAI', async () => {
  const { events } = await run('chat-text', {
    MONITORING: JSON.stringify({
      posthogDistinctId: 'synthetic-person',
      posthogTraceId: 'synthetic-trace',
      posthogGroups: { company: 'synthetic-company' },
      posthogProperties: { test_source: 'cassette' },
    }),
  })
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({
    distinct_id: 'synthetic-person',
    properties: { $ai_trace_id: 'synthetic-trace', $groups: { company: 'synthetic-company' }, test_source: 'cassette' },
  })
})

it('uses trace identity without creating a person when distinct ID is omitted', async () => {
  const { events } = await run('chat-text', { MONITORING: JSON.stringify({ posthogTraceId: 'anonymous-trace' }) })
  expect(events[0]).toMatchObject({
    distinct_id: 'anonymous-trace',
    properties: { $ai_trace_id: 'anonymous-trace', $process_person_profile: false },
  })
})

it('preserves caller token overrides without declaring their cache accounting convention', async () => {
  const { events } = await run('chat-text', {
    MONITORING: JSON.stringify({ posthogDistinctId: 'override-test', posthogProperties: { $ai_input_tokens: 5 } }),
  })
  expect(events[0].properties.$ai_input_tokens).toBe(5)
  expect(events[0].properties.$ai_cache_reporting_exclusive).toBeUndefined()
  expect(events[0].properties.$ai_usage).toMatchObject({ prompt_tokens: 17 })
})

it('applies model, provider and cost overrides without altering the upstream request', async () => {
  const { events } = await run('chat-text', {
    MONITORING: JSON.stringify({
      posthogDistinctId: 'override-test',
      posthogModelOverride: 'synthetic-model-alias',
      posthogProviderOverride: 'synthetic-provider-alias',
      posthogCostOverride: { inputCost: 0.01, outputCost: 0.02 },
    }),
  })
  expect(events[0].properties).toMatchObject({
    $ai_model: 'synthetic-model-alias',
    $ai_provider: 'synthetic-provider-alias',
  })
  expect(events[0].properties.$ai_input_cost_usd).toBeCloseTo(0.17)
  expect(events[0].properties.$ai_output_cost_usd).toBeCloseTo(0.12)
  expect(events[0].properties.$ai_total_cost_usd).toBeCloseTo(0.29)
})

it('preserves withResponse() metadata on the SDK promise', async () => {
  const { caller, cassette, events } = await run('chat-text', { HELPER: 'withResponse' })
  expect(caller.helperResult).toEqual({
    status: 200,
    requestId: cassette.interactions[0].response.headers['x-request-id'],
  })
  expect(events).toHaveLength(1)
})

it('preserves the Responses stream helper and finalResponse()', async () => {
  const { caller, cassette, events } = await run('responses-stream', { HELPER: 'stream' })
  expect(caller.helperResult).toMatchObject(terminalResult(providerResult(cassette.interactions[0])))
  expect(events).toHaveLength(1)
})
