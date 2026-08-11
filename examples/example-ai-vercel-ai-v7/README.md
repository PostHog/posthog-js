# Vercel AI SDK v7 + PostHog

This example uses the AI SDK v7 OpenTelemetry integration. The legacy PostHog
`withTracing` wrapper targets the AI SDK v5/v6 provider interfaces and rejects
v7 models with guidance to use this integration.

## Setup

AI SDK v7 and the compatible `@posthog/ai` release require Node.js 22.22 or
later.

Build the local package tarballs from the repository root before installing
the example:

```bash
pnpm install
pnpm package
cd examples/example-ai-vercel-ai-v7
pnpm install
POSTHOG_PROJECT_TOKEN=phc_... OPENAI_API_KEY=... OPENAI_MODEL=... pnpm start
```

Initialize the OpenTelemetry SDK and register the AI SDK integration before
the first AI SDK call. `@ai-sdk/otel` obtains a lazy tracer, so those two setup
calls do not require a specific relative order.

`PostHogSpanProcessor` batches spans by default. Request-scoped runtimes such
as serverless functions must await `posthogSpanProcessor.forceFlush()` before
their lifecycle ends, or attach that promise to a supported lifecycle hook
such as `waitUntil`. Explicit flushing waits for the batched export and avoids
the unbounded per-span request pattern of `SimpleSpanProcessor`.

## Runtime context and privacy

The example uses `runtimeContext`, `telemetry.includeRuntimeContext`, and
`enrichSpan` to add:

- `posthog.distinct_id` for per-user attribution
- `$ai_session_id` for AI session correlation
- `$ai_trace_name` for a stable PostHog trace name
- `$groups` as a JSON string that PostHog ingestion converts to native groups
- custom properties

Reserved PostHog attribution fields cannot be overridden through the custom
`properties` object.

With current `@ai-sdk/otel`, runtime context enrichment is available for
`generateText` and `streamText`. Object generation, embeddings, and reranking
do not pass runtime context to `enrichSpan` yet.

AI SDK v7 records inputs and outputs by default. This example keeps both
disabled unless `POSTHOG_CAPTURE_AI_CONTENT=true` is explicitly set. Only
enable content capture after reviewing the data for sensitive information and
obtaining any required consent.

## Validation

The integration test runs through `PostHogSpanProcessor` and its real OTLP HTTP
exporter against a local server. It proves the provider-v4 path, public
processor wiring, explicit flush, enriched attributes, reserved-key handling,
and content recording controls without sending data or calling a model:

```bash
pnpm build
pnpm test
```
