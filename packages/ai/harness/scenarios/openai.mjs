import OpenAI from '@posthog/ai/openai'
import { PostHog } from 'posthog-node'
import { openAIScenarios, executeOpenAIScenario, verifyOpenAIRecording } from '../openai-scenarios.mjs'

const original = openAIScenarios.find((item) => item.name === process.env.SCENARIO)
if (!original) throw new Error('Unknown OpenAI cassette scenario')
const scenario = structuredClone(original)
if (process.env.REQUEST) scenario.request = JSON.parse(process.env.REQUEST)
const monitoring = process.env.MONITORING ? JSON.parse(process.env.MONITORING) : { posthogDistinctId: 'cassette-test' }
const posthog = new PostHog('phc_cassette_test', {
  host: process.env.COLLECTOR_URL,
  flushAt: 1,
  flushInterval: 100,
  disableGeoip: true,
})
try {
  const client = new OpenAI({
    apiKey: 'fake-provider-secret',
    baseURL: `${process.env.PROVIDER_URL}/v1`,
    maxRetries: 0,
    timeout: 5000,
    logLevel: 'off',
    posthog,
  })
  let results = []
  let error
  let helperResult
  try {
    results = await executeOpenAIScenario(client, scenario, {
      monitoring,
      pollIntervalMs: 0,
      helper: process.env.HELPER,
      onHelper(result) {
        helperResult = result
      },
      onCall(result) {
        if (result.status) process.send?.({ type: 'status', status: result.status })
      },
      onEvent(event) {
        const text = event.choices?.[0]?.delta?.content ?? (typeof event.delta === 'string' ? event.delta : undefined)
        if (text) process.send?.({ type: 'text', text })
      },
    })
  } catch (caught) {
    if (process.env.EXPECT_ERROR !== '1') throw new Error('OpenAI cassette scenario failed')
    error = { name: caught.name, ...(typeof caught.status === 'number' ? { status: caught.status } : {}) }
  }
  if (process.env.EXPECT_ERROR === '1' && !error) throw new Error('Expected a provider error')
  if (!error) verifyOpenAIRecording(scenario, results)
  const expectedEventCount = Number(
    process.env.EXPECTED_EVENTS ??
      (scenario.expected.analytics === false ? 0 : scenario.expected.cacheHit ? results.length : 1)
  )
  if (expectedEventCount > 0) {
    const deadline = Date.now() + 5000
    while (true) {
      const response = await fetch(`${process.env.COLLECTOR_URL}/harness/received`, {
        signal: AbortSignal.timeout(1000),
      })
      if ((await response.json()).count >= expectedEventCount) break
      if (Date.now() > deadline) throw new Error('Analytics was not received before shutdown')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  process.stdout.write(JSON.stringify(error ? { error } : { results, ...(helperResult ? { helperResult } : {}) }))
} finally {
  await posthog.shutdown()
}
