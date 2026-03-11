"use node"

import { NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { action } from '../_generated/server'
import { v } from 'convex/values'

// Demonstrates using the Vercel AI SDK's experimental_telemetry with
// PostHog's native OTel endpoint to automatically capture $ai_generation events.
export const generate = action({
  args: {
    prompt: v.string(),
    distinctId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    // Set up an OTel trace provider that exports spans directly to PostHog's
    // /i/v0/ai/otel endpoint. PostHog converts gen_ai.* spans into
    // $ai_generation events server-side.
    const exporter = new OTLPTraceExporter({
      url: `${process.env.POSTHOG_HOST || 'https://us.i.posthog.com'}/i/v0/ai/otel`,
      headers: {
        Authorization: `Bearer ${process.env.POSTHOG_API_KEY}`,
      },
    })

    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        'posthog.distinct_id': args.distinctId ?? 'anonymous',
      }),
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })
    provider.register()

    const result = await generateText({
      model: openai('gpt-4o-mini'),
      prompt: args.prompt,
      experimental_telemetry: { isEnabled: true },
    })

    await provider.forceFlush()
    await provider.shutdown()

    return { text: result.text, usage: result.usage }
  },
})
