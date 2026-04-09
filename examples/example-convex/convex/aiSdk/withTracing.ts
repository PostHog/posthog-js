import { PostHog } from 'posthog-node/edge'
import { withTracing } from '@posthog/ai'
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { action } from '../_generated/server'
import { v } from 'convex/values'

// withTracing expects PostHog from posthog-node (node entry) but Convex
// requires the edge entry. The public API is identical — only a protected
// method signature differs — so we extract the expected type here.
type WithTracingPostHog = Parameters<typeof withTracing>[1]

// Initialize PostHog node client for automatic LLM tracing.
// Uses Convex environment variables set via `npx convex env set`.
const phClient = new PostHog(process.env.POSTHOG_API_KEY!, {
    host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
})

// Demonstrates using the Vercel AI SDK with @posthog/ai's withTracing
// to automatically capture $ai_generation events to PostHog.
export const generate = action({
    args: {
        prompt: v.string(),
        distinctId: v.optional(v.string()),
    },
    handler: async (_ctx, args) => {
        // Wrap the model with PostHog tracing — this automatically captures
        // $ai_generation events with token usage, latency, and content.
        const model = withTracing(openai('gpt-5-mini'), phClient as unknown as WithTracingPostHog, {
            posthogDistinctId: args.distinctId,
        })

        const result = await generateText({
            model,
            prompt: args.prompt,
        })

        await phClient.flush()

        return { text: result.text, usage: result.usage }
    },
})
