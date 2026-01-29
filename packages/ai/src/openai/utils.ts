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
