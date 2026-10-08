import type { GenerateContentResponseUsageMetadata } from '@google/genai'
import type { TokenUsage } from '../types'

/** Map Gemini usage metadata to PostHog's provider-agnostic token fields. */
export function mapGeminiUsage(
  metadata?: GenerateContentResponseUsageMetadata,
  additionalUsage: Pick<TokenUsage, 'webSearchCount'> = {}
): TokenUsage {
  return {
    inputTokens: metadata?.promptTokenCount ?? 0,
    outputTokens: metadata?.candidatesTokenCount ?? 0,
    reasoningTokens: metadata?.thoughtsTokenCount ?? 0,
    cacheReadInputTokens: metadata?.cachedContentTokenCount ?? 0,
    // Gemini counts cachedContentTokenCount inside promptTokenCount, so declare
    // the accounting model rather than leaving ingestion to infer it. Under
    // explicit context caching the two measurements can differ by a few percent.
    ...(metadata?.cachedContentTokenCount ? { cacheReportingExclusive: false } : {}),
    ...additionalUsage,
    rawUsage: metadata,
  }
}
