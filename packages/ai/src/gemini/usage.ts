import type { GenerateContentResponse, GenerateContentResponseUsageMetadata } from '@google/genai'
import type { TokenUsage } from '../types'

/** Built-in tools seen in a response, or across the chunks of a stream. */
export interface GeminiRetrievalTools {
  googleSearch: boolean
  urlContext: boolean
  codeExecution: boolean
}

export function emptyGeminiRetrievalTools(): GeminiRetrievalTools {
  return { googleSearch: false, urlContext: false, codeExecution: false }
}

/** Record which built-in tools a response (or a streamed chunk) used. */
export function detectGeminiRetrievalTools(
  response: Pick<GenerateContentResponse, 'candidates'>,
  seen: GeminiRetrievalTools = emptyGeminiRetrievalTools()
): GeminiRetrievalTools {
  for (const candidate of response.candidates ?? []) {
    const grounding = candidate.groundingMetadata
    // Web and image Search only: File Search also fills groundingChunks, with
    // retrievedContext, and its retrieved tokens are billed as input.
    if (
      (grounding?.webSearchQueries?.length ?? 0) > 0 ||
      (grounding?.imageSearchQueries?.length ?? 0) > 0 ||
      grounding?.groundingChunks?.some((chunk) => Boolean(chunk.web || chunk.image))
    ) {
      seen.googleSearch = true
    }
    if (candidate.urlContextMetadata) {
      seen.urlContext = true
    }
    if (candidate.content?.parts?.some((part) => Boolean(part.executableCode || part.codeExecutionResult))) {
      seen.codeExecution = true
    }
  }
  return seen
}

/**
 * Whether toolUsePromptTokenCount is billed as input. Google bills the content
 * that URL context, Code Execution, File Search and the other built-in tools add
 * to the prompt as input, but not the context retrieved by Grounding with Google
 * Search (https://ai.google.dev/gemini-api/docs/pricing). When Search ran with
 * URL context or Code Execution, the count cannot be split, so it is billed.
 */
export function geminiToolUseTokensBilled(tools: GeminiRetrievalTools): boolean {
  return !tools.googleSearch || tools.urlContext || tools.codeExecution
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
