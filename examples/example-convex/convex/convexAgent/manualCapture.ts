import { Agent } from '@convex-dev/agent'
import { openai } from '@ai-sdk/openai'
import { components } from '../_generated/api'
import { action } from '../_generated/server'
import { v } from 'convex/values'
import { posthog } from '../posthog.js'

const supportAgent = new Agent(components.agent, {
  name: 'support-agent',
  languageModel: openai('gpt-4o-mini'),
  instructions: 'You are a helpful support agent. Answer questions concisely.',
})

export const generate = action({
  args: {
    prompt: v.string(),
    distinctId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { thread } = await supportAgent.createThread(ctx, {})

    const startTime = Date.now()

    // Collect usage metadata from the usageHandler callback, then combine it
    // with the full result to send a comprehensive $ai_generation event.
    const usageData: {
      model?: string
      provider?: string
      agentName?: string
    } = {}

    const result = await thread.generateText(
      { prompt: args.prompt },
      {
        usageHandler: async (_usageCtx, { model, provider, agentName }) => {
          usageData.model = model
          usageData.provider = provider
          usageData.agentName = agentName
        },
      }
    )

    const latency = (Date.now() - startTime) / 1000

    await posthog.capture(ctx, {
      distinctId: args.distinctId ?? 'anonymous',
      event: '$ai_generation',
      properties: {
        // Core identification
        $ai_provider: usageData.provider,
        $ai_model: usageData.model,
        $ai_span_name: usageData.agentName,

        // Token usage (from totalUsage to account for multi-step tool calls)
        $ai_input_tokens: result.totalUsage.inputTokens,
        $ai_output_tokens: result.totalUsage.outputTokens,

        // Cache tokens (if the provider reports them)
        $ai_cache_read_input_tokens: result.totalUsage.cachedInputTokens,

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
      usage: result.totalUsage,
    }
  },
})
