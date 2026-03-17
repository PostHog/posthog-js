"use node"

import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
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
    // Set up an OTel SDK that exports spans directly to PostHog's
    // /i/v0/ai/otel endpoint. PostHog converts gen_ai.* spans into
    // $ai_generation events server-side. NodeSDK (vs NodeTracerProvider)
    // handles context propagation via AsyncLocalStorage automatically,
    // which the AI SDK needs to connect parent and child spans.
    const exporter = new OTLPTraceExporter({
      url: `${process.env.POSTHOG_HOST || 'https://us.i.posthog.com'}/i/v0/ai/otel`,
      headers: {
        Authorization: `Bearer ${process.env.POSTHOG_API_KEY}`,
      },
    })

    const distinctId = args.distinctId ?? 'anonymous'

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        'service.name': 'example-convex',
        'user.id': distinctId,
      }),
      traceExporter: exporter,
    })
    sdk.start()

    const result = await generateText({
      model: openai('gpt-5-mini'),
      prompt: args.prompt,
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'convex-ai-sdk-otel',
        metadata: {
          posthog_distinct_id: distinctId,
        },
      },
    })

    await sdk.shutdown()

    return { text: result.text, usage: result.usage }
  },
})
