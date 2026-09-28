import Anthropic from '@anthropic-ai/sdk'
import { VERSION } from '@anthropic-ai/sdk/version'
import { deepStrictEqual } from 'node:assert'
import { fileURLToPath } from 'node:url'
import { startRecorder, startReplay } from './cassette.ts'
import { recordingScenarios, verifyRecording } from './recording-scenarios.mjs'

if (
  !['anthropic-stream', 'anthropic-cache', 'anthropic-tools'].includes(process.argv[2]) ||
  process.argv.length !== 3
) {
  throw new Error('Usage: pnpm cassette:record <anthropic-stream|anthropic-cache|anthropic-tools>')
}
const apiKey = process.env.ANTHROPIC_API_KEY
const model = process.env.ANTHROPIC_MODEL
if (!apiKey || !model) throw new Error('Recording requires ANTHROPIC_API_KEY and ANTHROPIC_MODEL')
async function consume(url, key, request) {
  const client = new Anthropic({ apiKey: key, baseURL: url, maxRetries: 0, timeout: 10000 })
  const events = []
  for await (const event of await client.messages.create(request)) events.push(event)
  return events
}
async function record() {
  for (const scenario of await recordingScenarios(process.argv[2], model)) {
    const path = fileURLToPath(new URL(`./fixtures/${scenario.name}.live.json`, import.meta.url))
    const recorder = await startRecorder({
      path,
      upstreamURL: 'https://api.anthropic.com',
      secrets: [apiKey],
      provenance: {
        source: 'anthropic',
        recordedAt: new Date().toISOString(),
        providerSdkVersion: VERSION,
      },
    })
    let recorded
    try {
      recorded = await consume(recorder.url, apiKey, scenario.request)
      verifyRecording(scenario, recorded)
      await recorder.finish()
    } finally {
      await recorder.close()
    }
    const replay = await startReplay({ path })
    try {
      deepStrictEqual(await consume(replay.url, 'fake-replay-key', scenario.request), recorded)
      await replay.finish()
      console.log(
        `Saved ${scenario.name}.live.json and verified SDK replay. Review it and add independent analytics expectations before committing.`
      )
    } finally {
      await replay.close()
    }
  }
}
await record().catch(() => {
  // SDK errors may include provider responses or credentials. Never print them.
  console.error('Recording failed. No further scenarios were attempted; committed fixtures are unchanged.')
  process.exitCode = 1
})
