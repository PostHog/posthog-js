import { PostHogTracingProcessor } from './processor'
import type { PostHogTracingProcessorOptions } from './processor'

export { PostHogTracingProcessor } from './processor'
export type { PostHogTracingProcessorOptions, DistinctIdResolver } from './processor'

export type InstrumentOptions = PostHogTracingProcessorOptions

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
 * // Simple setup — await before running agents
 * await instrument({ client: phClient, distinctId: 'user@example.com' })
 *
 * // With dynamic distinct ID
 * await instrument({
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
export async function instrument(options: InstrumentOptions): Promise<PostHogTracingProcessor> {
  const { addTraceProcessor } = await import('@openai/agents-core')

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
