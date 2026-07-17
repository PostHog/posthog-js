# PostHog AI package

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [AI observability installation docs](https://posthog.com/docs/ai-observability/installation)
- [AI observability docs](https://posthog.com/docs/ai-observability)

## AI gateway tracing

```ts
import { PostHogSpanProcessor } from '@posthog/ai/otel'
import { NodeSDK } from '@opentelemetry/sdk-node'

const sdk = new NodeSDK({
  spanProcessors: [
    new PostHogSpanProcessor({
      projectSecret: process.env.POSTHOG_PROJECT_SECRET_KEY!,
    }),
  ],
})

sdk.start()
```

`PostHogSpanProcessor` is the recommended tracing integration. `PostHogTraceExporter` remains available for frameworks that only accept a trace exporter. Evaluation logs use the standard OpenTelemetry logs pipeline.

## Questions?

### [Check out our community page.](https://posthog.com/posts)
