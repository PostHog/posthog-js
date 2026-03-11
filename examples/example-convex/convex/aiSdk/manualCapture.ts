"use node"

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
    const startTime = Date.now()

    const result = await generateText({
      model: openai('gpt-4o-mini'),
      prompt: args.prompt,
    })

    const latency = (Date.now() - startTime) / 1000

    await posthog.capture(ctx, {
      distinctId: args.distinctId,
      event: '$ai_generation',
      properties: {
        // Core identification
        $ai_provider: 'openai',
        $ai_model: 'gpt-4o-mini',

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

        // Generation metadata
        $ai_http_status: result.response.headers?.['status'] ? Number(result.response.headers['status']) : 200,
        $ai_is_error: result.finishReason === 'error',
      },
    })

    return {
      text: result.text,
      usage: result.usage,
    }
  },
})
