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
  image: string
}

/**
 * Union type for all formatted content items
 */
export type FormattedContentItem = FormattedTextContent | FormattedFunctionCall | FormattedImageContent

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
 * Token usage information for AI model responses
 */
export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: unknown // Use unknown since various providers return different types
  cacheReadInputTokens?: unknown // Use unknown for provider flexibility
  cacheCreationInputTokens?: unknown // Use unknown for provider flexibility
  webSearchCount?: number // Count of web search queries/calls used
}
