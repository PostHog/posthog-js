"use node"

import { NodeSDK } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { Agent } from '@convex-dev/agent'
import { openai } from '@ai-sdk/openai'
import { PostHogTraceExporter } from '@posthog/ai/otel'
import { components } from '../_generated/api'
import { action } from '../_generated/server'
import { v } from 'convex/values'

// Demonstrates using @convex-dev/agent with the Vercel AI SDK's
// experimental_telemetry and PostHog's PostHogTraceExporter to
// automatically capture $ai_generation events.
export const generate = action({
  args: {
    prompt: v.string(),
    distinctId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const distinctId = args.distinctId ?? 'anonymous'

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        'service.name': 'example-convex',
        'user.id': distinctId,
      }),
      traceExporter: new PostHogTraceExporter({
        apiKey: process.env.POSTHOG_API_KEY!,
        host: process.env.POSTHOG_HOST,
      }),
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
