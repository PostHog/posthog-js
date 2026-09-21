import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { recordingScenarios, verifyRecording } from './recording-scenarios.mjs'

it('requests a forced client tool with artificial Paris/celsius arguments', async () => {
  const scenarios = await recordingScenarios('anthropic-tools', 'chosen-model')
  expect(scenarios).toHaveLength(1)
  expect(scenarios[0]).toMatchObject({
    name: 'anthropic-tools',
    request: {
      model: 'chosen-model',
      max_tokens: 256,
      stream: true,
      tool_choice: { type: 'tool', name: 'get_weather' },
      tools: [
        {
          name: 'get_weather',
          input_schema: {
            type: 'object',
            properties: { city: { type: 'string' }, unit: { type: 'string', enum: ['celsius'] } },
            required: ['city', 'unit'],
          },
        },
      ],
    },
  })
  expect(scenarios[0].request.messages).toEqual([{ role: 'user', content: expect.stringMatching(/Paris.*celsius/i) }])
})

it('verifies the requested client tool name, decoded arguments, and tool_use stop reason', async () => {
  const [scenario] = await recordingScenarios('anthropic-tools', 'chosen-model')
  const eventsFor = (name = 'get_weather', input = '{"city":"Paris","unit":"celsius"}', reason = 'tool_use') => [
    {
      type: 'message_start',
      message: {
        usage: {
          input_tokens: 19,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
        },
      },
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_weather', name, input: {} },
    },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: input.slice(0, 12) } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: input.slice(12) } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: reason }, usage: { output_tokens: 23 } },
    { type: 'message_stop' },
  ]
  expect(() => verifyRecording(scenario, eventsFor())).not.toThrow()
  const textOnly = [
    eventsFor()[0],
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Paris weather.' } },
    ...eventsFor().slice(4),
  ]
  for (const invalid of [
    textOnly,
    eventsFor('other_tool'),
    eventsFor('get_weather', '{"city":"London","unit":"celsius"}'),
    eventsFor('get_weather', '{"city":"Paris","unit":"fahrenheit"}'),
    eventsFor('get_weather', '{"city":"Paris","unit":"celsius","extra":true}'),
    eventsFor('get_weather', '{"city":"Paris","unit":"celsius"}', 'end_turn'),
  ]) {
    expect(() => verifyRecording(scenario, invalid)).toThrow('recording rejected')
  }
})

it('refreshes every cache scenario in dependency order with a shared fresh prefix', async () => {
  const first = await recordingScenarios('anthropic-cache', 'chosen-model')
  const second = await recordingScenarios('anthropic-cache', 'chosen-model')
  expect(first.map((scenario) => scenario.name)).toEqual([
    'anthropic-cache-5m-write',
    'anthropic-cache-5m-hit',
    'anthropic-cache-5m-extend',
    'anthropic-cache-1h-write',
    'anthropic-cache-1h-hit',
    'anthropic-cache-1h-extend',
    'anthropic-cache-mixed-write',
    'anthropic-cache-mixed-hit',
    'anthropic-cache-mixed-extend',
    'anthropic-cache-below-minimum',
    'anthropic-max-tokens',
  ])
  for (const index of [0, 3, 6]) {
    expect(first[index + 1].request.system).toEqual(first[index].request.system)
    expect(first[index].request.system[0].text).not.toEqual(second[index].request.system[0].text)
  }
  for (const index of [0, 3]) {
    expect(first[index + 2].request.system[0]).toEqual(first[index].request.system[0])
  }
  expect(first[8].request.system[0]).toEqual(first[3].request.system[0])
  expect(first.every((scenario) => scenario.request.model === 'chosen-model')).toBe(true)
})

it('accepts the independently recorded cache states and rejects a missing TTL breakdown or wrong stop reason', async () => {
  const scenarios = [
    ...(await recordingScenarios('anthropic-stream', 'model')),
    ...(await recordingScenarios('anthropic-cache', 'model')),
  ]
  for (const scenario of scenarios) {
    const fixture = JSON.parse(await readFile(new URL(`./fixtures/${scenario.name}.json`, import.meta.url), 'utf8'))
    const events = fixture.interactions[0].response.body.chunks.flatMap((chunk: string) =>
      chunk
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => JSON.parse(line.slice(5)))
    )
    expect(() => verifyRecording(scenario, events)).not.toThrow()
    const invalid = structuredClone(events)
    invalid.findLast((event) => event.type === 'message_delta').delta.stop_reason = 'unexpected'
    expect(() => verifyRecording(scenario, invalid)).toThrow('recording rejected')
    const missingBreakdown = structuredClone(events)
    for (const event of missingBreakdown) {
      if (event.message?.usage) delete event.message.usage.cache_creation
      if (event.usage) delete event.usage.cache_creation
    }
    expect(() => verifyRecording(scenario, missingBreakdown)).toThrow('recording rejected')
    expect(() =>
      verifyRecording({ ...scenario, cacheState: scenario.cacheState.map((value) => !value) }, events)
    ).toThrow('recording rejected')
  }
})
