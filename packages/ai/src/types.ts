/**
 * Type definitions for PostHog AI SDK
 * These types are used for formatting responses across different AI providers
 */

/**
 * Formatted text content item
 */
export interface FormattedTextContent {
  type: 'text'
  text: string
}

/**
 * Formatted function/tool call content item
 */
export interface FormattedFunctionCall {
  type: 'function'
  id?: string
  function: {
    name: string
    arguments: string | Record<string, unknown>
  }
}

/**
 * Formatted image content item
 */
export interface FormattedImageContent {
  type: 'image'
  image?: string
  inline_data?: {
    mime_type: string
    data: string
  }
}

/**
 * Formatted audio content item
 */
export interface FormattedAudioContent {
  type: 'audio'
  mime_type?: string
  data: string
  id?: string
  expires_at?: number
  transcript?: string
}

/**
 * Formatted document content item (PDFs, etc.)
 */
export interface FormattedDocumentContent {
  type: 'document'
  inline_data?: {
    mime_type: string
    data: string
  }
  source?: {
    type: 'base64'
    media_type: string
    data: string
  }
}

/**
 * Union type for all formatted content items
 */
export type FormattedContentItem =
  | FormattedTextContent
  | FormattedFunctionCall
  | FormattedImageContent
  | FormattedAudioContent
  | FormattedDocumentContent

/**
 * Array of formatted content items
 */
export type FormattedContent = FormattedContentItem[]

/**
 * Formatted message structure returned by format functions
 */
export interface FormattedMessage {
  role: string
  content: FormattedContent | unknown // Use unknown for better type safety with raw content
}

/**
 * Token usage reported by the provider.
 *
 * The counts are optional because an absent count means the provider never reported one, which is
 * not the same as zero: a failed or cancelled call can consume its prompt without ever reporting
 * usage. Error paths pass whatever arrived before the failure, or `{}` when nothing did, and never
 * substitute zeros. Costs follow the same rule, so a configured price applies only to a count that
 * exists.
 */
export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: unknown // Use unknown since various providers return different types
  cacheReadInputTokens?: unknown // Use unknown for provider flexibility
  cacheCreationInputTokens?: unknown // Use unknown for provider flexibility
  // Whether cache tokens are counted separately from inputTokens. Providers that report
  // them as a subset of inputTokens set this false. Left undefined when the provider's
  // accounting model is not known, in which case ingestion infers it from the counts.
  cacheReportingExclusive?: boolean
  webSearchCount?: number // Count of web search queries/calls used
  rawUsage?: unknown // Raw provider usage metadata for backend processing
}

/**
 * Options for fetching a prompt
 */
export interface GetPromptOptions {
  cacheTtlSeconds?: number
  fallback?: string
  /** Specific prompt version to fetch. Mutually exclusive with label. */
  version?: number
  /** Fetch the version this label currently points to, e.g. 'production'. Mutually exclusive with version. */
  label?: string
}

/**
 * Cached prompt with metadata
 */
export interface CachedPrompt {
  prompt: string
  name: string
  version: number
  label?: string
  config: Record<string, unknown> | null
  fetchedAt: number
}

/**
 * API response for LLM prompts
 */
export interface PromptApiResponse {
  id: number
  name: string
  prompt: string
  version: number
  /** Present when the prompt was fetched by label. */
  label?: string
  /** Model parameters or agent configuration stored with the version. Absent on older servers. */
  config?: unknown
  created_by: string
  created_at: string
  updated_at: string
  deleted: boolean
}

/**
 * Result from the Prompts API or local cache — carries real metadata.
 */
export interface PromptRemoteResult {
  source: 'api' | 'cache' | 'stale_cache'
  prompt: string
  name: string
  version: number
  /** The label the prompt was fetched by, when fetching with the label option. */
  label?: string
  /**
   * JSON object of model parameters or agent configuration stored with the
   * prompt version, or null when the version has none. Use defensive access,
   * e.g. `result.config ?? {}` — fallback results carry no config.
   */
  config: Record<string, unknown> | null
}

/**
 * Result when the fetch failed and no cache was available — fell back to the
 * hardcoded fallback string. name and version are undefined so they remain
 * accessible on the PromptResult union without a type guard.
 */
export interface PromptCodeFallbackResult {
  source: 'code_fallback'
  prompt: string
  name: undefined
  version: undefined
  label: undefined
  config: undefined
}

/**
 * Discriminated union returned by `Prompts.get()`.
 *
 * Narrow on `source` to guarantee metadata, or access `result.name` /
 * `result.version` directly as `string | undefined` / `number | undefined`.
 */
export type PromptResult = PromptRemoteResult | PromptCodeFallbackResult

/**
 * Variables for prompt compilation
 */
export type PromptVariables = Record<string, string | number | boolean>

/**
 * Direct options for initializing Prompts without a PostHog client
 */
export interface PromptsDirectOptions {
  personalApiKey: string
  projectApiKey: string
  host?: string
  defaultCacheTtlSeconds?: number
}
