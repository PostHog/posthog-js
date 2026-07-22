import { PostHog } from 'posthog-node'
import { captureAiGeneration as baseCaptureAiGeneration, CaptureAiGenerationOptions } from '../captureAiGeneration'

/**
 * The declared convention only describes the wrapper's own usage numbers, so
 * when the caller passes any of these through posthogProperties the wrapper no
 * longer knows the convention of the reported counts (callers working around
 * the double-billing already pass exclusive ones) and must not declare it.
 * Output/reasoning token overrides don't affect the input/cache relationship,
 * so they don't suppress the declaration. Subset of the input/cache keys in
 * `TOKEN_PROPERTY_KEYS` (../utils.ts) — keep in sync if that taxonomy grows.
 */
const INPUT_OR_CACHE_TOKEN_KEYS = ['$ai_input_tokens', '$ai_cache_read_input_tokens', '$ai_cache_creation_input_tokens']

/**
 * OpenAI-compatible usage reports `prompt_tokens` INCLUSIVE of cached tokens
 * (`prompt_tokens_details.cached_tokens` is a subset of it), unlike Anthropic's
 * exclusive convention. Ingestion auto-classifies Claude-shaped models as
 * exclusive regardless of provider, so events for Claude served through
 * OpenAI-compatible hosts (e.g. OpenRouter) would get cache reads billed twice.
 * Declaring the convention on every event from this wrapper lets ingestion
 * normalize correctly (see PostHog/posthog#49252); for non-Claude models the
 * flag is a no-op. Callers can still override it via posthogProperties, and
 * when they pass through input or cache token counts themselves the flag stays
 * unset unless they declare it explicitly.
 */
export const captureAiGeneration = (client: PostHog, options: CaptureAiGenerationOptions): Promise<void> => {
  const props = options.properties
  // Own-property check, matching how getTokensSource detects passthrough and
  // how the properties spread actually copies values into the event.
  const callerReportsTokens =
    props !== undefined && INPUT_OR_CACHE_TOKEN_KEYS.some((key) => Object.prototype.hasOwnProperty.call(props, key))
  return baseCaptureAiGeneration(client, {
    ...options,
    properties: callerReportsTokens
      ? props
      : {
          $ai_cache_reporting_exclusive: false,
          ...props,
        },
  })
}
