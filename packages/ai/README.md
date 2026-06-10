# PostHog Node AI

TypeScript SDK for LLM observability with PostHog.

[SEE FULL DOCS](https://posthog.com/docs/ai-engineering/observability)

## Installation

Provider SDKs are optional peer dependencies, so you only install the SDK for the integration you use. Install `@posthog/ai` alongside it:

```bash
npm install @posthog/ai openai            # OpenAI / Azure OpenAI
npm install @posthog/ai @anthropic-ai/sdk # Anthropic
npm install @posthog/ai @google/genai     # Google Gemini
npm install @posthog/ai @langchain/core   # LangChain
# Vercel AI SDK (withTracing), captureAiGeneration, and OpenTelemetry need no provider SDK
```

Import each integration from its subpath:

| Integration | Import from | Peer to install |
| --- | --- | --- |
| OpenAI / Azure OpenAI | `@posthog/ai/openai` | `openai` |
| Anthropic | `@posthog/ai/anthropic` | `@anthropic-ai/sdk` |
| Google Gemini | `@posthog/ai/gemini` | `@google/genai` |
| LangChain | `@posthog/ai/langchain` | `@langchain/core` |
| Vercel AI SDK (`withTracing`) | `@posthog/ai` | — |
| Custom (`captureAiGeneration`) | `@posthog/ai` | — |

## Direct Provider Usage

```typescript
import { OpenAI } from '@posthog/ai/openai'
import { PostHog } from 'posthog-node'

const phClient = new PostHog('<YOUR_PROJECT_API_KEY>', { host: 'https://us.i.posthog.com' })

const client = new OpenAI({
  apiKey: '<YOUR_OPENAI_API_KEY>',
  posthog: phClient,
})

const completion = await client.chat.completions.create({
  model: 'gpt-5-mini',
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

## Custom and unsupported providers

For LLM calls that don't go through one of the wrapped clients — direct Cloudflare Workers AI bindings, TanStack AI adapters, custom HTTP clients — use `captureAiGeneration` to emit the same `$ai_generation` events the wrappers produce.

```typescript
import { captureAiGeneration } from '@posthog/ai'
import { PostHog } from 'posthog-node'

const phClient = new PostHog('<YOUR_PROJECT_API_KEY>', { host: 'https://us.i.posthog.com' })

const start = Date.now()
const result = await env.AI.run('@cf/zai-org/glm-4.7-flash', { messages, reasoning_effort: 'high' })

await captureAiGeneration(phClient, {
  distinctId: 'user_123',
  traceId: 'trace_abc',
  provider: 'cloudflare-workers-ai',
  model: '@cf/zai-org/glm-4.7-flash',
  input: messages,
  output: result.response,
  modelParameters: { reasoning_effort: 'high' },
  usage: { inputTokens: result.usage?.prompt_tokens, outputTokens: result.usage?.completion_tokens },
  latency: (Date.now() - start) / 1000,
  properties: { feature: 'transcript-toc' },
})

await phClient.shutdown()
```

`captureAiGeneration` is the same primitive that every other `@posthog/ai` wrapper funnels through, so the resulting events are indistinguishable from those produced by `withTracing`, `OpenAI`, `Anthropic`, etc.

## OpenTelemetry

`@posthog/ai/otel` provides two ways to send AI traces to PostHog via OpenTelemetry. Both automatically filter to AI-related spans only (`gen_ai.*`, `llm.*`, `ai.*`, `traceloop.*`) and PostHog converts them into `$ai_generation` events server-side. `projectToken` is required; a blank token disables the OpenTelemetry integration as a defensive no-op. This works with any LLM provider SDK that supports OpenTelemetry.

```bash
npm install @posthog/ai @opentelemetry/sdk-node @opentelemetry/sdk-trace-base @opentelemetry/exporter-trace-otlp-http
```

### PostHogSpanProcessor (recommended)

A self-contained `SpanProcessor` that handles batching and export internally. Use this when your setup accepts a span processor.

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node'
import { PostHogSpanProcessor } from '@posthog/ai/otel'
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'

const sdk = new NodeSDK({
  spanProcessors: [
    new PostHogSpanProcessor({
      projectToken: '<YOUR_PROJECT_TOKEN>',
      host: 'https://us.i.posthog.com', // optional, defaults to https://us.i.posthog.com
    }),
  ],
})
sdk.start()

const result = await generateText({
  model: openai('gpt-5-mini'),
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

### PostHogTraceExporter

A `TraceExporter` for APIs that only accept an exporter, such as Vercel's `registerOTel`.

```typescript
import { PostHogTraceExporter } from '@posthog/ai/otel'
import { registerOTel } from '@vercel/otel'

registerOTel({
  serviceName: 'my-app',
  traceExporter: new PostHogTraceExporter({
    projectToken: '<YOUR_PROJECT_TOKEN>',
    host: 'https://us.i.posthog.com', // optional, defaults to https://us.i.posthog.com
  }),
})
```

LLM Observability [docs](https://posthog.com/docs/ai-engineering/observability)

Please see the main [PostHog docs](https://www.posthog.com/docs).

## Questions?

### [Check out our community page.](https://posthog.com/posts)
