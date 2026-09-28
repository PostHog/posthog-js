import OpenAI from '@posthog/ai/openai'
import { APIError, RateLimitError } from 'openai'
import { PostHog } from 'posthog-node'

const posthog = new PostHog('phc_cassette_test', {
  host: process.env.COLLECTOR_URL,
  flushAt: 1,
  flushInterval: 100,
  disableGeoip: true,
})
const client = new OpenAI({
  apiKey: 'fake-provider-secret',
  baseURL: `${process.env.PROVIDER_URL}/v1`,
  maxRetries: 0,
  timeout: 3000,
  logLevel: 'off',
  posthog,
})
const monitoring = {
  posthogDistinctId: 'original-user',
  posthogTraceId: 'original-trace',
  posthogProperties: { scenario: 'original-request' },
}
const model = 'synthetic-model'
let result
try {
  if (process.env.SCENARIO === 'background') {
    const pending = await client.responses.create({ model, input: 'Say hello.', background: true, ...monitoring })
    const events = []
    for await (const event of await client.responses.retrieve(pending.id, { stream: true })) events.push(event)
    const first = await client.responses.retrieve(pending.id)
    const second = await client.responses.retrieve(pending.id)
    result = { pending: pending.status, events, retrieved: [first.status, second.status] }
  } else if (process.env.SCENARIO === 'failed-response') {
    const response = await client.responses.create({ model, input: 'Hello.', ...monitoring })
    result = { status: response.status, error: response.error }
  } else if (process.env.SCENARIO === 'failed-response-stream') {
    const events = []
    for await (const event of await client.responses.create({ model, input: 'Hello.', stream: true, ...monitoring }))
      events.push(event)
    result = { events }
  } else if (process.env.SCENARIO === 'stream-error' || process.env.SCENARIO === 'abort') {
    const stream = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Hello.' }],
      stream: true,
      ...monitoring,
    })
    const events = []
    try {
      for await (const event of stream) {
        events.push(event)
        if (process.env.SCENARIO === 'abort') stream.controller.abort()
      }
      if (process.env.SCENARIO === 'stream-error') throw new Error('Expected a streaming error')
      result = { events, aborted: stream.controller.signal.aborted }
    } catch (error) {
      if (process.env.SCENARIO !== 'stream-error' || !(error instanceof APIError))
        throw new Error('Unexpected stream error')
      result = { events, error: { isAPIError: true, message: error.message } }
    }
  } else if (process.env.SCENARIO === 'tools') {
    const events = []
    const stream = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Look up both cities.' }],
      tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }],
      stream: true,
      stream_options: { include_usage: true },
      ...monitoring,
    })
    for await (const event of stream) events.push(event)
    result = { events }
  } else {
    const stream = process.env.STREAM === '1'
    try {
      if (process.env.SURFACE === 'chat') {
        await client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: 'Hello.' }],
          stream,
          ...monitoring,
        })
      } else if (process.env.SURFACE === 'responses') {
        await client.responses.create({ model, input: 'Hello.', stream, ...monitoring })
      } else if (process.env.SURFACE === 'embeddings') {
        await client.embeddings.create({ model, input: 'Hello.', ...monitoring })
      } else if (process.env.SURFACE === 'audio') {
        await client.audio.transcriptions.create({
          model,
          file: new File(['artificial audio'], 'artificial.wav', { type: 'audio/wav' }),
          stream,
          ...monitoring,
        })
      } else throw new Error('Unknown lifecycle surface')
      throw new Error('Expected the provider request to fail')
    } catch (error) {
      if (error.status !== 429) throw new Error('Unexpected provider error')
      result = { error: { status: error.status, isRateLimitError: error instanceof RateLimitError } }
    }
  }
  if (process.env.EXPECT_EVENTS === '1') {
    const deadline = Date.now() + 3000
    while (true) {
      const response = await fetch(`${process.env.COLLECTOR_URL}/harness/received`, {
        signal: AbortSignal.timeout(1000),
      })
      if ((await response.json()).count >= 1) break
      if (Date.now() > deadline) throw new Error('Analytics was not received')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
} finally {
  await posthog.shutdown()
}
process.stdout.write(JSON.stringify(result))
