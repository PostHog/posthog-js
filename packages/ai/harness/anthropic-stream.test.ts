import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { startReplay } from './cassette'
import { startCollector } from './collector'

it('captures one generation with initial cache usage and final output usage through built SDKs', async () => {
  const replay = await startReplay({
    path: fileURLToPath(new URL('./fixtures/anthropic-stream.synthetic.json', import.meta.url)),
  })
  const collector = await startCollector()
  try {
    const result = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('./scenarios/anthropic-stream.mjs', import.meta.url))],
      {
        env: { PROVIDER_URL: replay.url, COLLECTOR_URL: collector.url },
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      }
    )
    expect(JSON.parse(result.stdout)).toEqual({ text: 'Hello.' })
    await replay.finish()
    collector.verify()
    expect(collector.events).toHaveLength(1)
    expect(collector.events[0]).toMatchObject({
      event: '$ai_generation',
      distinct_id: 'cassette-test',
      properties: {
        $ai_provider: 'anthropic',
        $ai_model: 'synthetic-model',
        $ai_input_tokens: 7,
        $ai_output_tokens: 3,
        $ai_cache_read_input_tokens: 11,
        $ai_cache_creation_input_tokens: 13,
        $ai_usage: {
          input_tokens: 7,
          output_tokens: 3,
          cache_read_input_tokens: 11,
          cache_creation_input_tokens: 13,
          cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 8 },
        },
        $ai_output_choices: [{ role: 'assistant', content: [{ type: 'text', text: 'Hello.' }] }],
      },
    })
  } finally {
    await replay.close()
    await collector.close()
  }
})
