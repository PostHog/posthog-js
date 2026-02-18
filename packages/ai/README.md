# PostHog Node AI

TypeScript SDK for LLM observability with PostHog.

[SEE FULL DOCS](https://posthog.com/docs/ai-engineering/observability)

## Installation

```bash
npm install @posthog/ai
```

## Direct Provider Usage

```typescript
import { OpenAI } from '@posthog/ai'
import { PostHog } from 'posthog-node'

const phClient = new PostHog('<YOUR_PROJECT_API_KEY>', { host: 'https://us.i.posthog.com' })

const client = new OpenAI({
  apiKey: '<YOUR_OPENAI_API_KEY>',
  posthog: phClient,
})

const completion = await client.chat.completions.create({
  model: 'gpt-3.5-turbo',
  messages: [{ role: 'user', content: 'Tell me a fun fact about hedgehogs' }],
  posthogDistinctId: 'user_123', // optional
  posthogTraceId: 'trace_123', // optional
  posthogProperties: { conversation_id: 'abc123', paid: true }, //optional
  posthogGroups: { company: 'company_id_in_your_db' }, // optional
  posthogPrivacyMode: false, // optional
})

console.log(completion.choices[0].message.content)

// YOU HAVE TO HAVE THIS OR THE CLIENT MAY NOT SEND EVENTS
await phClient.shutdown()
```

## OTEL + AI SDK (`experimental_telemetry`)

Use this when working with Vercel AI SDK telemetry. `@posthog/ai` exposes an OTEL `SpanProcessor` that maps spans to PostHog AI events and sends them through `posthog-node`.

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node'
import { PostHog } from 'posthog-node'
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { PostHogSpanProcessor } from '@posthog/ai/otel'

const phClient = new PostHog('<YOUR_PROJECT_API_KEY>', { host: 'https://us.i.posthog.com' })

const sdk = new NodeSDK({
  spanProcessors: [
    new PostHogSpanProcessor(phClient),
  ],
})

sdk.start()

await generateText({
  model: openai('gpt-5.1'),
  prompt: 'Write a short haiku about debugging',
  experimental_telemetry: {
    isEnabled: true,
    functionId: 'my-awesome-function',
    metadata: {
      conversation_id: 'abc123',
      plan: 'pro',
    },
  },
})

await phClient.shutdown()
```

### Custom Mappers

The OTEL processor supports adapter mappers for different span formats:

- `aiSdkSpanMapper` is the default mapper.
- You can pass custom `mappers` in `PostHogSpanProcessor` options to support additional span schemas.

### Per-call Metadata (Recommended)

For dynamic properties, pass values in `experimental_telemetry.metadata` on each AI SDK call.
These are captured from `ai.telemetry.metadata.*` and forwarded as PostHog event properties.
Use processor options (`posthogProperties`) only for global defaults.

## Notes

- The OTEL route currently maps supported spans into PostHog AI events (manual capture path).
- Existing wrapper-based tracing (for example `withTracing`) still works and is unchanged.

LLM Observability [docs](https://posthog.com/docs/ai-engineering/observability)

Please see the main [PostHog docs](https://www.posthog.com/docs).

## Questions?

### [Check out our community page.](https://posthog.com/posts)
