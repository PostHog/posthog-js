import Anthropic from '@anthropic-ai/sdk'
import { deepStrictEqual } from 'node:assert'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { startRecorder, startReplay } from './cassette.ts'

if (process.argv[2] !== 'anthropic-stream' || process.argv.length !== 3) {
  throw new Error('Usage: pnpm cassette:record anthropic-stream')
}
const apiKey = process.env.ANTHROPIC_API_KEY
const model = process.env.ANTHROPIC_MODEL
if (!apiKey || !model) throw new Error('Recording requires ANTHROPIC_API_KEY and ANTHROPIC_MODEL')
const path = fileURLToPath(new URL('./fixtures/anthropic-stream.live.json', import.meta.url))
const request = { model, max_tokens: 32, messages: [{ role: 'user', content: 'Say hello.' }], stream: true }
async function consume(url, key) {
  const client = new Anthropic({ apiKey: key, baseURL: url, maxRetries: 0, timeout: 10000 })
  const events = []
  for await (const event of await client.messages.create(request)) events.push(event)
  return events
}
const recorder = await startRecorder({
  path,
  upstreamURL: 'https://api.anthropic.com',
  secrets: [apiKey],
  provenance: {
    source: 'anthropic',
    recordedAt: new Date().toISOString(),
    providerSdkVersion: createRequire(import.meta.url)('@anthropic-ai/sdk/package.json').version,
  },
})
let recorded
try {
  recorded = await consume(recorder.url, apiKey)
  await recorder.finish()
} finally {
  await recorder.close()
}
const replay = await startReplay({ path })
try {
  deepStrictEqual(await consume(replay.url, 'fake-replay-key'), recorded)
  await replay.finish()
  console.log(
    'Saved anthropic-stream.live.json and verified SDK replay. Review it and add independent analytics expectations before committing.'
  )
} finally {
  await replay.close()
}
