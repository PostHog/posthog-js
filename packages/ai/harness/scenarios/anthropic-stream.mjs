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
    model: 'synthetic-model',
    max_tokens: 32,
    messages: [{ role: 'user', content: 'Say hello.' }],
    stream: true,
    posthogDistinctId: 'cassette-test',
  })
  let text = ''
  for await (const item of stream) {
    if (item.type === 'content_block_delta' && item.delta.type === 'text_delta') text += item.delta.text
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
  process.stdout.write(JSON.stringify({ text }))
} finally {
  await posthog.shutdown()
}
