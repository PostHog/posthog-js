import { deepStrictEqual } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { startRecorder, startReplay } from './cassette.ts'
import { consumeGemini, geminiGroups, geminiScenario, verifyGeminiRecording } from './gemini-scenarios.mjs'

async function record() {
  const group = process.argv[2]
  if (process.argv.length !== 3 || !geminiGroups.includes(group)) throw new Error('Invalid recording selection')
  const apiKey = process.env.GEMINI_API_KEY
  const model = group === 'embed' ? process.env.GEMINI_EMBEDDING_MODEL : process.env.GEMINI_MODEL
  if (!apiKey || !model) throw new Error('Missing recording configuration')
  const scenario = geminiScenario(group, model)
  const sdkPackage = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.resolve('@google/genai')), 'utf8')
  )
  const path = fileURLToPath(new URL(`./fixtures/${scenario.name}.live.json`, import.meta.url))
  const recorder = await startRecorder({
    path,
    upstreamURL: 'https://generativelanguage.googleapis.com',
    secrets: [apiKey],
    provenance: { source: 'gemini', recordedAt: new Date().toISOString(), providerSdkVersion: sdkPackage.version },
  })
  let recorded
  try {
    recorded = await consumeGemini(recorder.url, apiKey, scenario)
    verifyGeminiRecording(scenario, recorded)
    await recorder.finish()
  } finally {
    await recorder.close()
  }
  const replay = await startReplay({ path })
  try {
    deepStrictEqual(await consumeGemini(replay.url, 'fake-gemini-key', scenario), recorded)
    await replay.finish()
    console.log(
      `Saved ${scenario.name}.live.json and verified SDK replay. Review it and add independent analytics expectations before committing.`
    )
  } finally {
    await replay.close()
  }
}

await record().catch(() => {
  // SDK errors can contain raw responses or credentials.
  console.error(
    'Gemini recording failed. Check the group and required environment variables. Committed fixtures are unchanged.'
  )
  process.exitCode = 1
})
