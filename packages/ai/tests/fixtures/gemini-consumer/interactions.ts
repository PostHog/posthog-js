import { PostHogGoogleGenAI as Gemini } from '@posthog/ai/gemini'
import type { PostHog } from 'posthog-node'

declare const posthog: PostHog
const client = new Gemini({ apiKey: 'consumer-fixture', posthog })

async function interactions(streaming: boolean) {
  const response = await client.interactions.create(
    {
      model: 'gemini-synthetic',
      input: [
        { type: 'user_input', content: [{ type: 'text', text: 'Hello' }] },
        { type: 'model_output', content: [{ type: 'text', text: 'Checking' }] },
        { type: 'function_call', id: 'call_fixture', name: 'weather', arguments: { city: 'Paris' } },
        { type: 'function_result', name: 'weather', call_id: 'call_fixture', result: 'Sunny' },
      ],
      posthogDistinctId: 'consumer',
    },
    { timeout: 1000, maxRetries: 0 }
  )
  const id: string = response.id
  const stream = await client.interactions.create({ model: 'gemini-synthetic', input: 'Hello', stream: true })
  const reader = stream.getReader()
  const event = await reader.read()
  if (!event.done) {
    const type: string = event.value.event_type
    void type
  }
  reader.releaseLock()
  const branches: [ReadableStream<unknown>, ReadableStream<unknown>] = stream.tee()
  await Promise.all(branches.map((branch) => branch.cancel()))
  const dynamic = await client.interactions.create({ model: 'gemini-synthetic', input: 'Hello', stream: streaming })
  void dynamic
  return id
}

// @ts-expect-error Agent lifecycle tracing is intentionally unsupported.
client.interactions.create({ agent: 'agent', input: 'Hello' })
// @ts-expect-error Background lifecycle tracing is intentionally unsupported.
client.interactions.create({ model: 'gemini-synthetic', input: 'Hello', background: true })
void interactions
