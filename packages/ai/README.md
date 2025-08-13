# PostHog Node AI

Initial Typescript SDK for LLM Observability

[SEE FULL DOCS](https://posthog.com/docs/ai-engineering/observability)

## Installation

```bash
npm install @posthog/ai
```

## Usage

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

LLM Observability [docs](https://posthog.com/docs/ai-engineering/observability)

Please see the main [PostHog docs](https://www.posthog.com/docs).

## Questions?

### [Check out our community page.](https://posthog.com/posts)
