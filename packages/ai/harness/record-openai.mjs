import OpenAI from 'openai'
import { VERSION } from 'openai/version'
import { deepStrictEqual } from 'node:assert'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { startRecorder, startReplay } from './cassette.ts'
import { openAIScenarios, executeOpenAIScenario, verifyOpenAIRecording } from './openai-scenarios.mjs'

const selected = process.argv[2]
if (process.argv.length !== 3 || (selected !== 'all' && !openAIScenarios.some((item) => item.name === selected))) {
  throw new Error('Usage: node harness/record-openai.mjs <scenario-name|all>')
}
const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) throw new Error('Recording requires OPENAI_API_KEY')

async function record() {
  const cleanup = new OpenAI({
    apiKey,
    baseURL: 'https://api.openai.com/v1',
    maxRetries: 0,
    timeout: 10000,
    logLevel: 'off',
  })
  for (const original of openAIScenarios.filter((item) => selected === 'all' || item.name === selected)) {
    const scenario = structuredClone(original)
    if (scenario.expected.cacheHit) {
      const nonce = randomUUID()
      scenario.request.prompt_cache_key = `posthog-cassette-${nonce}`
      if (scenario.operation === 'chat.create') {
        scenario.request.messages[0].content = `Recording ${nonce}.\n${scenario.request.messages[0].content}`
      } else {
        const prefix = scenario.request.input[0].content[0]
        prefix.text = `Recording ${nonce}.\n${prefix.text}`
      }
    }
    const path = fileURLToPath(new URL(`./fixtures/${scenario.name}.live.json`, import.meta.url))
    const recorder = await startRecorder({
      path,
      upstreamURL: 'https://api.openai.com',
      secrets: [apiKey],
      provenance: { source: 'openai', recordedAt: new Date().toISOString(), providerSdkVersion: VERSION },
    })
    const responseIDs = new Set()
    let recorded
    let cleanupFailed = false
    try {
      const client = new OpenAI({
        apiKey,
        baseURL: `${recorder.url}/v1`,
        maxRetries: 0,
        timeout: 30000,
        logLevel: 'off',
      })
      recorded = await executeOpenAIScenario(client, scenario, { onCreatedResponse: (id) => responseIDs.add(id) })
      verifyOpenAIRecording(scenario, recorded)
      await recorder.finish()
    } finally {
      try {
        await recorder.close()
      } finally {
        for (const id of responseIDs) {
          try {
            await cleanup.responses.cancel(id)
          } catch {
            // A completed response no longer needs cancellation.
          }
          try {
            await cleanup.responses.delete(id)
          } catch {
            console.error('A test background response could not be deleted. Check the provider dashboard.')
            cleanupFailed = true
          }
        }
      }
    }
    if (cleanupFailed) throw new Error('Background response cleanup failed')
    const replay = await startReplay({ path })
    try {
      const client = new OpenAI({
        apiKey: 'fake-replay-key',
        baseURL: `${replay.url}/v1`,
        maxRetries: 0,
        timeout: 5000,
        logLevel: 'off',
      })
      deepStrictEqual(await executeOpenAIScenario(client, scenario, { pollIntervalMs: 0 }), recorded)
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
  // Provider errors can include credentials or response bodies.
  console.error('Recording failed. No further scenarios were attempted; committed fixtures are unchanged.')
  process.exitCode = 1
})
