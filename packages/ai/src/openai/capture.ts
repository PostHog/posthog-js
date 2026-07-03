import { PostHog } from 'posthog-node'
import { captureAiGeneration as baseCaptureAiGeneration, CaptureAiGenerationOptions } from '../captureAiGeneration'

/**
 * OpenAI-compatible usage reports `prompt_tokens` INCLUSIVE of cached tokens
 * (`prompt_tokens_details.cached_tokens` is a subset of it), unlike Anthropic's
 * exclusive convention. Ingestion auto-classifies Claude-shaped models as
 * exclusive regardless of provider, so events for Claude served through
 * OpenAI-compatible hosts (e.g. OpenRouter) would get cache reads billed twice.
 * Declaring the convention on every event from this wrapper lets ingestion
 * normalize correctly (see PostHog/posthog#49252); for non-Claude models the
 * flag is a no-op. Callers can still override it via posthogProperties.
 */
export const captureAiGeneration = (client: PostHog, options: CaptureAiGenerationOptions): Promise<void> =>
  baseCaptureAiGeneration(client, {
    ...options,
    properties: {
      $ai_cache_reporting_exclusive: false,
      ...options.properties,
    },
  })
