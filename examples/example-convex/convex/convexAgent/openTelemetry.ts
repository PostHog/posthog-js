"use node"

import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { Agent } from '@convex-dev/agent'
import { openai } from '@ai-sdk/openai'
import { components } from '../_generated/api'
import { action } from '../_generated/server'
import { v } from 'convex/values'

// Demonstrates using @convex-dev/agent with the Vercel AI SDK's
// experimental_telemetry and PostHog's native OTel endpoint to
// automatically capture $ai_generation events.
export const generate = action({
  args: {
    prompt: v.string(),
    distinctId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
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

    const supportAgent = new Agent(components.agent, {
      name: 'support-agent',
      languageModel: openai('gpt-5-mini'),
      instructions: 'You are a helpful support agent. Answer questions concisely.',
    })

    const { thread } = await supportAgent.createThread(ctx, {})

    const result = await thread.generateText({
      prompt: args.prompt,
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'convex-agent-otel',
        metadata: {
          posthog_distinct_id: distinctId,
        },
      },
    })

    await sdk.shutdown()

    return {
      text: result.text,
      usage: result.totalUsage,
    }
  },
})
