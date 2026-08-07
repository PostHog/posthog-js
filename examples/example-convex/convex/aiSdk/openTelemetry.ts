// Convex runs in a V8 isolate without the `performance` global that
// @opentelemetry/core expects. This must be imported before any OTEL module.
import '../polyfills.js'

import { trace } from '@opentelemetry/api'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { PostHogSpanProcessor } from '@posthog/ai/otel'
import { action } from '../_generated/server'
import { v } from 'convex/values'

const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
        'service.name': 'example-convex',
    }),
    spanProcessors: [
        new PostHogSpanProcessor({
            projectToken: process.env.POSTHOG_PROJECT_TOKEN!,
            host: process.env.POSTHOG_HOST,
        }),
    ],
})
trace.setGlobalTracerProvider(provider)

// Demonstrates using the Vercel AI SDK's experimental_telemetry with
// PostHog's PostHogSpanProcessor to automatically capture $ai_generation events.
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

        try {
            await provider.forceFlush()
        } catch (error) {
            console.error('Failed to flush PostHog telemetry', error)
        }

        return { text: result.text, usage: result.usage }
    },
})
