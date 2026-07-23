# PostHog AI package

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [AI observability installation docs](https://posthog.com/docs/ai-observability/installation)
- [AI observability docs](https://posthog.com/docs/ai-observability)

## AI gateway tracing

Pass a PostHog project secret (`phs_...`) as `projectSecret` to send AI telemetry through PostHog AI Gateway. This selects the gateway automatically and defaults to `https://ai-gateway.us.posthog.com`; you do not need to set `host`.

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

Using `projectToken: 'phc_...'` instead sends traces directly to PostHog's OTLP ingestion endpoint and does not use AI Gateway. `PostHogSpanProcessor` is the recommended tracing integration. `PostHogTraceExporter` remains available for frameworks that only accept a trace exporter. Evaluation logs use the standard OpenTelemetry logs pipeline.

## Questions?

### [Check out our community page.](https://posthog.com/posts)
