import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { startReplay } from './cassette'
import { startCollector } from './collector'

const scenarios = [
  {
    fixture: 'anthropic-stream.json',
    model: 'claude-haiku-4-5-20251001',
    text: 'Hello! 👋\n\nHow can I help you today?',
    input: 10,
    output: 16,
    cacheRead: 0,
    cacheCreation: 0,
    cache5m: 0,
    cache1h: 0,
  },
]

// Independently checked against the provider's live message_start/message_delta usage.
// Columns: fixture, text, input, output, cache read, 5-minute write, 1-hour write.
const cacheCases = [
  ['cache-5m-write', 'OK.', 10, 5, 0, 9650, 0],
  ['cache-5m-hit', 'OK.', 10, 5, 9650, 0, 0],
  ['cache-5m-extend', 'OK', 11, 4, 9650, 1201, 0],
  ['cache-1h-write', 'OK.', 10, 5, 0, 0, 9650],
  ['cache-1h-hit', 'OK.', 10, 5, 9650, 0, 0],
  ['cache-1h-extend', 'OK', 11, 4, 9650, 0, 1201],
  ['cache-mixed-write', 'OK.', 11, 5, 0, 1501, 9649],
  ['cache-mixed-hit', 'OK.', 11, 5, 11150, 0, 0],
  ['cache-mixed-extend', 'OK.', 11, 5, 9650, 1501, 1500],
  ['cache-below-minimum', 'OK.', 16, 5, 0, 0, 0],
  ['max-tokens', '', 13, 1, 0, 0, 0],
] as const
for (const [name, text, input, output, cacheRead, cache5m, cache1h] of cacheCases) {
  scenarios.push({
    fixture: `anthropic-${name}.json`,
    model: 'claude-haiku-4-5-20251001',
    text,
    input,
    output,
    cacheRead,
    cacheCreation: cache5m + cache1h,
    cache5m,
    cache1h,
  })
}

it.each(scenarios)('captures one generation through built SDKs from $fixture', async (scenario) => {
  const path = fileURLToPath(new URL(`./fixtures/${scenario.fixture}`, import.meta.url))
  const cassette = JSON.parse(await readFile(path, 'utf8'))
  const replay = await startReplay({
    path,
  })
  const collector = await startCollector()
  try {
    const result = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('./scenarios/anthropic-stream.mjs', import.meta.url))],
      {
        env: {
          PROVIDER_URL: replay.url,
          COLLECTOR_URL: collector.url,
          REQUEST: JSON.stringify(cassette.interactions[0].request.body),
        },
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      }
    )
    expect(JSON.parse(result.stdout)).toEqual({ text: scenario.text })
    await replay.finish()
    collector.verify()
    expect(collector.events).toHaveLength(1)
    expect(collector.events[0]).toMatchObject({
      event: '$ai_generation',
      distinct_id: 'cassette-test',
      properties: {
        $ai_provider: 'anthropic',
        $ai_model: scenario.model,
        $ai_input_tokens: scenario.input,
        $ai_output_tokens: scenario.output,
        $ai_stop_reason: scenario.fixture === 'anthropic-max-tokens.json' ? 'max_tokens' : 'end_turn',
        $ai_usage: {
          input_tokens: scenario.input,
          output_tokens: scenario.output,
          cache_read_input_tokens: scenario.cacheRead,
          cache_creation_input_tokens: scenario.cacheCreation,
          cache_creation: { ephemeral_5m_input_tokens: scenario.cache5m, ephemeral_1h_input_tokens: scenario.cache1h },
        },
        $ai_output_choices: [{ role: 'assistant', content: [{ type: 'text', text: scenario.text }] }],
      },
    })
    // The capture contract omits zero cache counters but retains them in raw usage.
    expect(collector.events[0].properties.$ai_cache_read_input_tokens).toBe(scenario.cacheRead || undefined)
    expect(collector.events[0].properties.$ai_cache_creation_input_tokens).toBe(scenario.cacheCreation || undefined)
  } finally {
    await replay.close()
    await collector.close()
  }
})
