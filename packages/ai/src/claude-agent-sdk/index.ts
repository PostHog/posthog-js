import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { PostHogClaudeAgentProcessor } from './processor'
import type { ClaudeAgentQueryParams, PostHogClaudeAgentProcessorOptions } from './processor'

export { PostHogClaudeAgentProcessor } from './processor'
export type {
  PostHogClaudeAgentProcessorOptions,
  ClaudeAgentQueryParams,
  ClaudeAgentTraceOptions,
  DistinctIdResolver,
} from './processor'

export type InstrumentOptions = PostHogClaudeAgentProcessorOptions

/**
 * Create a PostHog-instrumented `query()` for the Claude Agent SDK.
 *
 * @param options - Configuration options
 * @returns A processor whose `query()` method replaces `query()` from the SDK
 *
 * @example
 * ```typescript
 * import { instrument } from '@posthog/ai/claude-agent-sdk'
 * import { PostHog } from 'posthog-node'
 *
 * const phClient = new PostHog('<POSTHOG_API_KEY>')
 * const claude = instrument({ client: phClient, distinctId: 'user@example.com' })
 *
 * for await (const message of claude.query({ prompt: 'Explain this repo' })) {
 *   console.log(message)
 * }
 * ```
 */
export function instrument(options: InstrumentOptions): PostHogClaudeAgentProcessor {
  return new PostHogClaudeAgentProcessor(options)
}

/**
 * Drop-in replacement for `query()` from the Claude Agent SDK, for a single
 * query. Use {@link instrument} to share one configuration across queries.
 *
 * @example
 * ```typescript
 * import { query } from '@posthog/ai/claude-agent-sdk'
 * import { PostHog } from 'posthog-node'
 *
 * const phClient = new PostHog('<POSTHOG_API_KEY>')
 *
 * for await (const message of query({
 *   prompt: 'Explain this repo',
 *   posthog: { client: phClient, distinctId: 'user@example.com' },
 * })) {
 *   console.log(message)
 * }
 * ```
 */
export function query(
  params: Omit<ClaudeAgentQueryParams, 'posthog'> & { posthog: PostHogClaudeAgentProcessorOptions }
): Query {
  const { prompt, options, posthog } = params
  return new PostHogClaudeAgentProcessor(posthog).query({ prompt, options })
}
