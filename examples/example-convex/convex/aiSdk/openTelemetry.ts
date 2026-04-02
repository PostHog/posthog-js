// Import the shared OTEL setup which registers PostHogTraceExporter
// as a span processor on the global tracer provider.
import '../otelSetup.js'

import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { action } from '../_generated/server'
import { v } from 'convex/values'

// Demonstrates using the Vercel AI SDK's experimental_telemetry with
// PostHog's PostHogTraceExporter to automatically capture $ai_generation events.
export const generate = action({
    args: {
        prompt: v.string(),
        distinctId: v.optional(v.string()),
    },
    handler: async (_ctx, args) => {
        const distinctId = args.distinctId ?? 'anonymous'

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

        return { text: result.text, usage: result.usage }
    },
})
