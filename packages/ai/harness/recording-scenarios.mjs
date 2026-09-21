import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'

// Cache reads, 5-minute writes, 1-hour writes. Counts can change between recordings.
const cacheStates = {
  'cache-5m-write': [false, true, false],
  'cache-5m-hit': [true, false, false],
  'cache-5m-extend': [true, true, false],
  'cache-1h-write': [false, false, true],
  'cache-1h-hit': [true, false, false],
  'cache-1h-extend': [true, false, true],
  'cache-mixed-write': [false, true, true],
  'cache-mixed-hit': [true, false, false],
  'cache-mixed-extend': [true, true, true],
  'cache-below-minimum': [false, false, false],
  'max-tokens': [false, false, false],
}

export async function recordingScenarios(group, model) {
  if (group === 'anthropic-tools') {
    return [
      {
        name: 'anthropic-tools',
        request: {
          model,
          max_tokens: 256,
          messages: [{ role: 'user', content: 'Get the weather in Paris in celsius.' }],
          tools: [
            {
              name: 'get_weather',
              description: 'Get the weather for a city.',
              input_schema: {
                type: 'object',
                properties: { city: { type: 'string' }, unit: { type: 'string', enum: ['celsius'] } },
                required: ['city', 'unit'],
              },
            },
          ],
          tool_choice: { type: 'tool', name: 'get_weather' },
          stream: true,
        },
        cacheState: [false, false, false],
      },
    ]
  }
  if (group === 'anthropic-stream') {
    return [
      {
        name: 'anthropic-stream',
        request: { model, max_tokens: 32, messages: [{ role: 'user', content: 'Say hello.' }], stream: true },
        cacheState: [false, false, false],
      },
    ]
  }
  if (group !== 'anthropic-cache') throw new Error('Unknown recording group')
  const nonce = randomUUID()
  return Promise.all(
    Object.entries(cacheStates).map(async ([name, cacheState]) => {
      const fixture = JSON.parse(await readFile(new URL(`./fixtures/anthropic-${name}.json`, import.meta.url), 'utf8'))
      const request = fixture.interactions[0].request.body
      request.model = model
      for (const block of request.system ?? []) {
        // Share a fresh prefix across writes, hits, and extensions, never a previous live cache.
        block.text = block.text.replace(
          /Artificial cassette validation [\da-f-]{36}/g,
          `Artificial cassette validation ${nonce}`
        )
      }
      return { name: `anthropic-${name}`, request, cacheState }
    })
  )
}

export function verifyRecording(scenario, events) {
  const start = events.find((event) => event.type === 'message_start')?.message?.usage
  const end = events.findLast((event) => event.type === 'message_delta')
  const usage = { ...start, ...end?.usage }
  const counts = [
    usage.cache_read_input_tokens,
    usage.cache_creation?.ephemeral_5m_input_tokens,
    usage.cache_creation?.ephemeral_1h_input_tokens,
  ]
  if (
    !start ||
    !end ||
    counts.some(
      (count, index) => !Number.isSafeInteger(count) || count < 0 || count > 0 !== scenario.cacheState[index]
    ) ||
    usage.cache_creation_input_tokens !== counts[1] + counts[2] ||
    end.delta?.stop_reason !==
      (scenario.name === 'anthropic-max-tokens'
        ? 'max_tokens'
        : scenario.name === 'anthropic-tools'
          ? 'tool_use'
          : 'end_turn')
  ) {
    throw new Error('Requested cache state or stop reason was not observed; recording rejected')
  }
  if (scenario.name === 'anthropic-tools') {
    const tools = events.filter(
      (event) => event.type === 'content_block_start' && event.content_block?.type === 'tool_use'
    )
    const tool = tools[0]
    const input = events
      .filter(
        (event) =>
          event.type === 'content_block_delta' &&
          event.index === tool?.index &&
          event.delta?.type === 'input_json_delta'
      )
      .map((event) => event.delta.partial_json)
      .join('')
    if (
      tools.length !== 1 ||
      tool.content_block.name !== 'get_weather' ||
      !isDeepStrictEqual(JSON.parse(input || '{}'), { city: 'Paris', unit: 'celsius' })
    ) {
      throw new Error('Requested tool call was not observed; recording rejected')
    }
  }
}
