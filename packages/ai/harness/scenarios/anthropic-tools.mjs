import Anthropic from '@posthog/ai/anthropic'
import { PostHog } from 'posthog-node'

const posthog = new PostHog('phc_cassette_test', {
  host: process.env.COLLECTOR_URL,
  flushAt: 1,
  flushInterval: 100,
  disableGeoip: true,
})
try {
  const anthropic = new Anthropic({
    apiKey: 'fake-provider-secret',
    baseURL: process.env.PROVIDER_URL,
    maxRetries: 0,
    timeout: 5000,
    posthog,
  })
  const stream = await anthropic.messages.create({
    ...JSON.parse(process.env.REQUEST),
    posthogDistinctId: 'cassette-test',
  })
  const events = []
  for await (const event of stream) {
    events.push(event)
    if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta' && event.delta.partial_json) {
      process.send?.({ type: 'tool-input', partial_json: event.delta.partial_json })
    }
  }
  const deadline = Date.now() + 5000
  while (true) {
    const response = await fetch(`${process.env.COLLECTOR_URL}/harness/received`, {
      signal: AbortSignal.timeout(1000),
    })
    if ((await response.json()).count > 0) break
    if (Date.now() > deadline) throw new Error('Analytics was not received before shutdown')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  process.stdout.write(JSON.stringify({ events }))
} finally {
  await posthog.shutdown()
}
