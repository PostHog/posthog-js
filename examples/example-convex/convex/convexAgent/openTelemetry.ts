// Import the shared OTEL setup which registers PostHogTraceExporter
// as a span processor on the global tracer provider.
import '../otelSetup.js'

import { Agent } from '@convex-dev/agent'
import { openai } from '@ai-sdk/openai'
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

        return {
            text: result.text,
            usage: result.totalUsage,
        }
    },
})
