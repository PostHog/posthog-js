import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { action } from '../_generated/server'
import { v } from 'convex/values'
import { posthog } from '../posthog.js'

// Demonstrates using the Vercel AI SDK (without @convex-dev/agent)
// to call an LLM and capture $ai_generation events to PostHog.
export const generate = action({
    args: {
        prompt: v.string(),
        distinctId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const traceId = crypto.randomUUID()
        const startTime = Date.now()

        const result = await generateText({
            model: openai('gpt-5-mini'),
            prompt: args.prompt,
        })

        const latency = (Date.now() - startTime) / 1000

        await posthog.capture(ctx, {
            distinctId: args.distinctId ?? 'anonymous',
            event: '$ai_generation',
            properties: {
                // Trace ID groups multiple generations into a single trace
                $ai_trace_id: traceId,

                // Core identification
                $ai_provider: 'openai',
                $ai_model: 'gpt-5-mini',

                // Token usage
                $ai_input_tokens: result.usage.inputTokens,
                $ai_output_tokens: result.usage.outputTokens,

                // Cache tokens (if the provider reports them)
                $ai_cache_read_input_tokens: result.usage.cachedInputTokens,

                // Performance
                $ai_latency: latency,

                // Input/output content
                $ai_input: [{ role: 'user', content: args.prompt }],
                $ai_output_choices: [{ role: 'assistant', content: result.text }],

                // Generation metadata — the AI SDK doesn't expose HTTP status directly,
                // so we infer success/failure from the finish reason.
                $ai_is_error: result.finishReason === 'error',
            },
        })

        return {
            text: result.text,
            usage: result.usage,
        }
    },
})
