export const geminiPath =
  /^\/v1beta\/models\/[a-zA-Z0-9][a-zA-Z0-9._-]*:(?:generateContent|batchEmbedContents|streamGenerateContent\?alt=sse)$/

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Gemini object')
  return value as Record<string, unknown>
}

function generationValidator(assertSafe: (value: unknown) => void) {
  const candidates = new Map<number, { finished: boolean; text: string; thought: string; allText: string }>()
  let blocked = false
  return {
    add(value: unknown) {
      const event = object(value)
      assertSafe(event)
      if ('error' in event) throw new Error('Gemini error response')
      if (event.promptFeedback !== undefined) {
        const feedback = object(event.promptFeedback)
        if (
          typeof feedback.blockReason === 'string' &&
          feedback.blockReason &&
          feedback.blockReason !== 'BLOCK_REASON_UNSPECIFIED'
        )
          blocked = true
      }
      if (event.candidates !== undefined) {
        if (!Array.isArray(event.candidates)) throw new Error('Invalid Gemini candidates')
        for (const item of event.candidates) {
          const candidate = object(item)
          const index = candidate.index ?? 0
          if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0)
            throw new Error('Invalid Gemini candidate index')
          const state = candidates.get(index) ?? { finished: false, text: '', thought: '', allText: '' }
          if (state.finished) throw new Error('Gemini candidate after completion')
          if (candidate.content !== undefined) {
            const content = object(candidate.content)
            if (!Array.isArray(content.parts)) throw new Error('Invalid Gemini parts')
            for (const value of content.parts) {
              const part = object(value)
              if (part.text !== undefined) {
                if (typeof part.text !== 'string') throw new Error('Invalid Gemini text')
                const field = part.thought === true ? 'thought' : 'text'
                state[field] += part.text
                state.allText += part.text
                assertSafe(state[field])
                assertSafe(state.allText)
              }
            }
          }
          if (candidate.finishReason !== undefined) {
            if (
              typeof candidate.finishReason !== 'string' ||
              !candidate.finishReason ||
              candidate.finishReason === 'FINISH_REASON_UNSPECIFIED'
            )
              throw new Error('Invalid Gemini finish reason')
            state.finished = true
          }
          candidates.set(index, state)
        }
      }
    },
    finish() {
      if ((!candidates.size && !blocked) || [...candidates.values()].some((candidate) => !candidate.finished))
        throw new Error('Incomplete Gemini generation')
    },
  }
}

export function validateGeminiJSON(path: string, value: unknown, assertSafe: (value: unknown) => void): void {
  const response = object(value)
  assertSafe(response)
  if ('error' in response) throw new Error('Gemini error response')
  if (path.endsWith(':batchEmbedContents')) {
    if (!Array.isArray(response.embeddings) || !response.embeddings.length) throw new Error('Missing Gemini embeddings')
    for (const item of response.embeddings) {
      const embedding = object(item)
      if (
        !Array.isArray(embedding.values) ||
        !embedding.values.length ||
        !embedding.values.every((value) => typeof value === 'number' && Number.isFinite(value))
      )
        throw new Error('Invalid Gemini embedding')
    }
  } else {
    const validator = generationValidator(assertSafe)
    validator.add(response)
    validator.finish()
  }
}

export function geminiStreamChunks(
  text: string,
  parseJSON: (text: string) => unknown,
  assertSafe: (value: unknown) => void
): string[] {
  assertSafe(text)
  const normalized = text.replace(/\r\n?/g, '\n')
  if (!normalized.endsWith('\n\n')) throw new Error('Incomplete Gemini SSE frame')
  const chunks = normalized
    .slice(0, -2)
    .split('\n\n')
    .map((chunk) => `${chunk}\n\n`)
  const validator = generationValidator(assertSafe)
  for (const chunk of chunks) {
    const data = chunk
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (data) validator.add(parseJSON(data))
  }
  // A usage-only final chunk is valid; completion belongs to the candidates, not the final frame.
  validator.finish()
  return chunks
}
