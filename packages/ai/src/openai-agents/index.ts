import type { PostHog } from 'posthog-node'
import { PostHogTracingProcessor } from './processor'
import type { DistinctIdResolver } from './processor'

export { PostHogTracingProcessor } from './processor'
export type { PostHogTracingProcessorOptions, DistinctIdResolver } from './processor'

export interface InstrumentOptions {
  client: PostHog
  distinctId?: DistinctIdResolver
  privacyMode?: boolean
  groups?: Record<string, any>
  properties?: Record<string, any>
}

/**
 * One-liner to instrument OpenAI Agents SDK with PostHog tracing.
 *
 * This registers a PostHogTracingProcessor with the OpenAI Agents SDK,
 * automatically capturing traces, spans, and LLM generations.
 *
 * @param options - Configuration options
 * @returns The registered processor instance
 *
 * @example
 * ```typescript
 * import { instrument } from '@posthog/ai/openai-agents'
 * import PostHog from 'posthog-node'
 *
 * const phClient = new PostHog('<API_KEY>')
 *
 * // Simple setup
 * instrument({ client: phClient, distinctId: 'user@example.com' })
 *
 * // With dynamic distinct ID
 * instrument({
 *   client: phClient,
 *   distinctId: (trace) => trace.metadata?.userId,
 *   privacyMode: true,
 *   properties: { environment: 'production' },
 * })
 *
 * // Now run agents as normal - traces automatically sent to PostHog
 * import { Agent, run } from '@openai/agents'
 * const agent = new Agent({ name: 'Assistant', instructions: 'You are helpful.' })
 * const result = await run(agent, 'Hello!')
 * ```
 */
export function instrument(options: InstrumentOptions): PostHogTracingProcessor {
  // Dynamic import to avoid requiring @openai/agents-core at module load time
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { addTraceProcessor } = require('@openai/agents-core')

  const processor = new PostHogTracingProcessor({
    client: options.client,
    distinctId: options.distinctId,
    privacyMode: options.privacyMode,
    groups: options.groups,
    properties: options.properties,
  })

  addTraceProcessor(processor)
  return processor
}
