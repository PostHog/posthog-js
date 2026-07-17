# PostHog AI package

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [AI observability installation docs](https://posthog.com/docs/ai-observability/installation)
- [AI observability docs](https://posthog.com/docs/ai-observability)

## AI gateway traces and scores

```ts
import { PostHogAI } from '@posthog/ai/otel'
import { NodeSDK } from '@opentelemetry/sdk-node'

const posthogAI = new PostHogAI({
  projectSecret: process.env.POSTHOG_PROJECT_SECRET_KEY!,
})

const sdk = new NodeSDK({
  spanProcessors: [posthogAI.spanProcessor],
})

sdk.start()

// Run inside the active span that contains the gateway call.
await posthogAI.score({
  requestId: response._request_id,
  name: 'answer-quality',
  value: 0.92,
})
```

`PostHogSpanProcessor` is the recommended tracing integration. `PostHogTraceExporter` remains available for frameworks that only accept a trace exporter.

## Questions?

### [Check out our community page.](https://posthog.com/posts)
