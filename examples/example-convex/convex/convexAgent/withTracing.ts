"use node"

import { PostHog } from 'posthog-node/edge'
import { withTracing } from '@posthog/ai'
import { Agent } from '@convex-dev/agent'
import { openai } from '@ai-sdk/openai'
import { components } from '../_generated/api'
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

// Demonstrates using @convex-dev/agent with @posthog/ai's withTracing
// to automatically capture $ai_generation events to PostHog.
export const generate = action({
  args: {
    prompt: v.string(),
    threadId: v.optional(v.string()),
    distinctId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Wrap the model with PostHog tracing before passing it to the agent.
    // Every LLM call the agent makes will automatically capture $ai_generation events.
    const model = withTracing(openai('gpt-4o-mini'), phClient as unknown as WithTracingPostHog, {
      posthogDistinctId: args.distinctId,
    })

    const supportAgent = new Agent(components.agent, {
      name: 'support-agent',
      languageModel: model,
      instructions: 'You are a helpful support agent. Answer questions concisely.',
    })

    const { thread } = args.threadId
      ? await supportAgent.continueThread(ctx, { threadId: args.threadId })
      : await supportAgent.createThread(ctx, {})

    const result = await thread.generateText({ prompt: args.prompt })

    await phClient.flush()

    return {
      text: result.text,
      threadId: thread.threadId,
      usage: result.totalUsage,
    }
  },
})
