# PostHog Node AI

TypeScript SDK for LLM Observability

[SEE FULL DOCS](https://posthog.com/docs/llm-observability)

## Installation

```bash
npm install @posthog/ai posthog-node
```

## Usage

```typescript
import { OpenAI } from '@posthog/ai'
import { PostHog } from 'posthog-node'

const phClient = new PostHog(
  '<ph_project_api_key>',
  { host: '<ph_client_api_host>' }
);

const openai = new OpenAI({
  apiKey: 'your_openai_api_key',
  posthog: phClient,
});

const completion = await openai.responses.create({
  model: 'gpt-4o-mini',
  input: [{ role: 'user', content: 'Tell me a fun fact about hedgehogs' }],
  posthogDistinctId: 'user_123', // optional
  posthogTraceId: 'trace_123', // optional
  posthogProperties: { conversation_id: 'abc123', paid: true }, // optional
  posthogGroups: { company: 'company_id_in_your_db' }, // optional
  posthogPrivacyMode: false // optional
});

console.log(completion.choices[0].message.content)

// IMPORTANT: Shutdown the client when you're done to ensure all events are sent
await phClient.shutdown()
```

LLM Observability [docs](https://posthog.com/docs/llm-observability)

Please see the main [PostHog docs](https://www.posthog.com/docs).

## Questions?

### [Check out our community page.](https://posthog.com/posts)
