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
 * Assembles the `$ai_provider_metadata` blob for OpenAI / Azure OpenAI events.
 * Provider-specific fields (system fingerprint, request id) live here rather
 * than in the shared, provider-agnostic `$ai_*` namespace. Only keys with a
 * truthy value are included, and `undefined` is returned when there is nothing
 * to report so the property can be omitted from the event entirely.
 */
export function buildProviderMetadata(fields: {
  systemFingerprint?: string | null
  requestId?: string | null
}): Record<string, string> | undefined {
  const metadata: Record<string, string> = {}
  if (fields.systemFingerprint) {
    metadata.system_fingerprint = fields.systemFingerprint
  }
  if (fields.requestId) {
    metadata.request_id = fields.requestId
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined
}
