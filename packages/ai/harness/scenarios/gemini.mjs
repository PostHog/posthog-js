import Gemini from '@posthog/ai/gemini'
import { PostHog } from 'posthog-node'
import { geminiClientOptions, geminiOperations, generationResult } from '../gemini-scenarios.mjs'

const posthog = new PostHog('phc_cassette_test', {
  host: process.env.COLLECTOR_URL,
  flushAt: 1,
  flushInterval: 100,
  disableGeoip: true,
})
try {
  const operation = process.env.GEMINI_OPERATION
  if (!geminiOperations.includes(operation)) throw new Error('Unsupported scenario operation')
  const client = new Gemini({ ...geminiClientOptions(process.env.PROVIDER_URL, 'fake-gemini-key'), posthog })
  const request = { posthogDistinctId: 'cassette-test', ...JSON.parse(process.env.GEMINI_REQUEST) }
  let result
  if (operation === 'generateContentStream') {
    const chunks = []
    let text = ''
    for await (const chunk of client.models.generateContentStream(request)) {
      chunks.push(generationResult(chunk))
      if (chunk.text) {
        text += chunk.text
        process.send?.({ type: 'text', text: chunk.text })
      }
    }
    result = { text, chunks }
  } else if (operation === 'embedContent') {
    result = { embeddings: (await client.models.embedContent(request)).embeddings }
  } else {
    result = generationResult(await client.models.generateContent(request))
  }
  process.stdout.write(JSON.stringify(result))
} catch {
  process.stdout.write(JSON.stringify({ error: true }))
  process.exitCode = 1
} finally {
  await posthog.shutdown()
}
