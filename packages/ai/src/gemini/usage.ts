import type { GenerateContentResponse, GenerateContentResponseUsageMetadata } from '@google/genai'
import type { TokenUsage } from '../types'

/** Built-in retrieval tools seen in a response, or across the chunks of a stream. */
export interface GeminiRetrievalTools {
  googleSearch: boolean
  urlContext: boolean
}

/** Record which built-in retrieval tools a response (or a streamed chunk) used. */
export function detectGeminiRetrievalTools(
  response: Pick<GenerateContentResponse, 'candidates'>,
  seen: GeminiRetrievalTools = { googleSearch: false, urlContext: false }
): GeminiRetrievalTools {
  for (const candidate of response.candidates ?? []) {
    if ((candidate.groundingMetadata?.webSearchQueries?.length ?? 0) > 0) {
      seen.googleSearch = true
    }
    if ((candidate.urlContextMetadata?.urlMetadata?.length ?? 0) > 0) {
      seen.urlContext = true
    }
  }
  return seen
}

/**
 * Whether toolUsePromptTokenCount is billed as input. Google bills the content
 * that URL context and the other built-in tools add to the prompt as input, but
 * not the context retrieved by Grounding with Google Search
 * (https://ai.google.dev/gemini-api/docs/pricing). A response that used both
 * Search and URL context cannot be split from these counts, so it is billed.
 */
export function geminiToolUseTokensBilled(tools: GeminiRetrievalTools): boolean {
  return !tools.googleSearch || tools.urlContext
}

/** Map Gemini usage metadata to PostHog's provider-agnostic token fields. */
export function mapGeminiUsage(
  metadata?: GenerateContentResponseUsageMetadata,
  additionalUsage: Pick<TokenUsage, 'webSearchCount'> = {},
  { billToolUseTokens = true }: { billToolUseTokens?: boolean } = {}
): TokenUsage {
  return {
    // Tool-use prompt tokens (built-in tools such as URL context) are reported
    // outside promptTokenCount. They are billed as input unless they are Google
    // Search retrieval (see geminiToolUseTokensBilled).
    inputTokens: (metadata?.promptTokenCount ?? 0) + (billToolUseTokens ? (metadata?.toolUsePromptTokenCount ?? 0) : 0),
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
