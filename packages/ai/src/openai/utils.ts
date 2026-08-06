import type OpenAI from 'openai'

/**
 * Checks if a ResponseStreamEvent chunk represents the first token/content from the model.
 * This includes various content types like text, reasoning, audio, and refusals.
 */
export function isResponseTokenChunk(chunk: OpenAI.Responses.ResponseStreamEvent): boolean {
  return (
    chunk.type === 'response.output_item.added' ||
    chunk.type === 'response.content_part.added' ||
    chunk.type === 'response.output_text.delta' ||
    chunk.type === 'response.reasoning_text.delta' ||
    chunk.type === 'response.reasoning_summary_text.delta' ||
    chunk.type === 'response.audio.delta' ||
    chunk.type === 'response.audio.transcript.delta' ||
    chunk.type === 'response.refusal.delta'
  )
}

/**
 * Reads the OpenAI SDK's `_request_id` field from a response object. The SDK
 * attaches the `x-request-id` response header here, but it is not part of the
 * public response types, so it has to be read through a cast. Used to populate
 * `$ai_provider_metadata.request_id`.
 */
export function extractRequestId(result: unknown): string | undefined {
  return (result as { _request_id?: string | null } | null | undefined)?._request_id ?? undefined
}

/**
 * Reads the `cache_write_tokens` field from a Chat Completions
 * `usage.prompt_tokens_details` object. OpenAI-compatible providers (and OpenAI
 * itself on newer models) report cache-creation tokens here, but the field is
 * absent from the pinned SDK's types, so it has to be read through a cast. Used
 * to populate `$ai_cache_creation_input_tokens`.
 */
export function extractCacheWriteTokens(promptTokensDetails: unknown): number {
  return (promptTokensDetails as { cache_write_tokens?: number } | null | undefined)?.cache_write_tokens ?? 0
}

/**
 * Assembles the `$ai_provider_metadata` blob for OpenAI / Azure OpenAI events.
 * Provider-specific fields (system fingerprint, request id) live here rather
 * than in the shared, provider-agnostic `$ai_*` namespace. Only keys with a
 * meaningful value are included, and `undefined` is returned when there is nothing
 * to report so the property can be omitted from the event entirely.
 */
export function buildProviderMetadata(fields: {
  systemFingerprint?: string | null
  requestId?: string | null
  incompleteDetails?: OpenAI.Responses.Response['incomplete_details']
}): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {}
  if (fields.systemFingerprint) {
    metadata.system_fingerprint = fields.systemFingerprint
  }
  if (fields.requestId) {
    metadata.request_id = fields.requestId
  }
  if (fields.incompleteDetails != null) {
    metadata.incomplete_details = fields.incompleteDetails
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined
}

const TERMINAL_RESPONSE_STATUSES = new Set(['completed', 'failed', 'cancelled', 'incomplete'])

/**
 * Checks whether a Responses API response has reached a status that should
 * produce a final `$ai_generation` event.
 */
export function isTerminalResponse(response: { status?: string | null } | null | undefined): boolean {
  return !!response?.status && TERMINAL_RESPONSE_STATUSES.has(response.status)
}

/**
 * Returns an isolated copy of a failed Responses API error for `$ai_error`, or
 * creates a fallback error when the provider omitted failure details.
 */
export function getResponseFailure(
  response: Pick<OpenAI.Responses.Response, 'id' | 'status' | 'error'> | null | undefined
): unknown {
  if (response?.status !== 'failed') {
    return undefined
  }

  return response.error
    ? { ...response.error }
    : new Error(`OpenAI response ${response.id} failed without error details`)
}
