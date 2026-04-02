// Convex runs in a V8 isolate without the `performance` global that
// @opentelemetry/core expects. This must be imported before any OTEL module.
import './polyfills.js'

import { trace } from '@opentelemetry/api'
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { PostHogTraceExporter } from '@posthog/ai/otel'

// Application-level OTEL setup. PostHogTraceExporter is a standard OTEL
// SpanExporter — add it as a span processor alongside any other exporters
// you use (e.g. Datadog, Honeycomb, Jaeger).
const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
        'service.name': 'example-convex',
    }),
    spanProcessors: [
        new BatchSpanProcessor(
            new PostHogTraceExporter({
                apiKey: process.env.POSTHOG_API_KEY!,
                host: process.env.POSTHOG_HOST,
            })
        ),
        // Add other span processors here, e.g.:
        // new BatchSpanProcessor(new OTLPTraceExporter({ url: '...' })),
    ],
})
trace.setGlobalTracerProvider(provider)
