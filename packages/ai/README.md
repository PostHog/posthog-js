# PostHog AI package

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [AI observability installation docs](https://posthog.com/docs/ai-observability/installation)
- [AI observability docs](https://posthog.com/docs/ai-observability)

## AI gateway tracing

Set `aiGateway` with a PostHog project secret (`phs_...`) to send AI telemetry through PostHog AI Gateway. Gateway routing is explicit at the call site. Its host defaults to `https://ai-gateway.us.posthog.com`; set `aiGateway.host` to `https://ai-gateway.eu.posthog.com` for EU or to your development or self-hosted gateway URL.

```ts
import { PostHogSpanProcessor } from '@posthog/ai/otel'
import { NodeSDK } from '@opentelemetry/sdk-node'

const sdk = new NodeSDK({
  spanProcessors: [
    new PostHogSpanProcessor({
      aiGateway: {
        projectSecret: process.env.POSTHOG_PROJECT_SECRET_KEY!,
        host: process.env.POSTHOG_AI_GATEWAY_HOST,
      },
    }),
  ],
})

sdk.start()
```

Using `projectToken: 'phc_...'` sends traces directly to PostHog's OTLP ingestion endpoint and does not use AI Gateway. `PostHogSpanProcessor` is the recommended tracing integration. `PostHogTraceExporter` remains available for frameworks that only accept a trace exporter. Evaluation logs use the standard OpenTelemetry logs pipeline.

## Questions?

### [Check out our community page.](https://posthog.com/posts)
