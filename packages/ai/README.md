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
  model: 'gpt-4o-mini',
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

## OpenTelemetry

`@posthog/ai` provides a `PostHogTraceExporter` that sends OpenTelemetry traces to PostHog's OTLP ingestion endpoint. PostHog converts `gen_ai.*` spans into `$ai_generation` events server-side. This works with any LLM provider SDK that supports OpenTelemetry.

```bash
npm install @posthog/ai @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
```

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node'
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { PostHogTraceExporter } from '@posthog/ai/otel'

const sdk = new NodeSDK({
  traceExporter: new PostHogTraceExporter({
    apiKey: '<YOUR_PROJECT_API_KEY>',
    host: 'https://us.i.posthog.com', // optional, defaults to https://us.i.posthog.com
  }),
})
sdk.start()

const result = await generateText({
  model: openai('gpt-4o-mini'),
  prompt: 'Write a short haiku about debugging',
  experimental_telemetry: {
    isEnabled: true,
    functionId: 'my-awesome-function',
    metadata: {
      posthog_distinct_id: 'user_123',
      conversation_id: 'abc123',
    },
  },
})

await sdk.shutdown()
```

LLM Observability [docs](https://posthog.com/docs/ai-engineering/observability)

Please see the main [PostHog docs](https://www.posthog.com/docs).

## Questions?

### [Check out our community page.](https://posthog.com/posts)
