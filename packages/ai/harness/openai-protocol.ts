type AssertSafe = (value: unknown) => void
type JsonObject = Record<string, unknown>

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object')
  return value as JsonObject
}

export function safeJson(text: string, assertSafe: AssertSafe): unknown {
  const value: unknown = JSON.parse(text)
  // Inspect strings before duplicate keys can hide a credential from the parsed object.
  for (const match of text.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
    const decoded: unknown = JSON.parse(match[0])
    assertSafe(decoded)
    if (/^\s*:/.test(text.slice(match.index + match[0].length))) assertSafe({ [String(decoded)]: null })
  }
  assertSafe(value)
  return value
}

function checkArguments(value: unknown, assertSafe: AssertSafe): void {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (key === 'arguments' && typeof child === 'string' && child) object(safeJson(child, assertSafe))
    else checkArguments(child, assertSafe)
  }
}

export function openaiJson(text: string, path: string, assertSafe: AssertSafe): unknown {
  const value = object(safeJson(text, assertSafe))
  if (value.error != null) throw new Error('Provider error')
  if (path === '/v1/chat/completions' && !Array.isArray(value.choices)) throw new Error('Missing Chat choices')
  if (path.startsWith('/v1/responses')) {
    if (!['queued', 'in_progress', 'completed', 'incomplete', 'cancelled'].includes(String(value.status))) {
      throw new Error('Invalid Response status')
    }
  }
  if (path === '/v1/embeddings' && !Array.isArray(value.data)) throw new Error('Missing embeddings')
  if (path === '/v1/audio/transcriptions' && typeof value.text !== 'string') throw new Error('Missing transcript')
  checkArguments(value, assertSafe)
  return value
}

export function openaiStream(text: string, path: string, assertSafe: AssertSafe): string[] {
  assertSafe(text)
  const normalized = text.replace(/\r\n/g, '\n')
  if (!normalized.endsWith('\n\n')) throw new Error('Incomplete SSE frame')
  const chunks = normalized
    .slice(0, -2)
    .split('\n\n')
    .map((chunk) => `${chunk}\n\n`)
  const texts = new Map<string, string>()
  const arguments_ = new Map<string, string>()
  const choices = new Map<number, boolean>()
  let done = false
  let sentinel = false
  const append = (values: Map<string, string>, key: string, value: unknown) => {
    if (typeof value === 'string') values.set(key, (values.get(key) ?? '') + value)
  }
  for (const chunk of chunks) {
    const data = chunk
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data) continue
    // Transcription sends a final sentinel after its semantic completion event.
    if (path === '/v1/audio/transcriptions' && done && !sentinel && data === '[DONE]') {
      sentinel = true
      continue
    }
    if (done) throw new Error('Event after stream completion')
    if (data === '[DONE]') {
      if (path !== '/v1/chat/completions' || !choices.size || [...choices.values()].some((finished) => !finished)) {
        throw new Error('Unexpected stream completion')
      }
      done = true
      continue
    }
    const event = object(safeJson(data, assertSafe))
    if (event.error != null || event.type === 'error') throw new Error('Provider error')
    if (path === '/v1/chat/completions') {
      if (!Array.isArray(event.choices)) throw new Error('Missing Chat choices')
      for (const item of event.choices) {
        const choice = object(item)
        if (!Number.isInteger(choice.index)) throw new Error('Missing choice index')
        const index = choice.index as number
        if (choices.get(index)) throw new Error('Delta after choice completion')
        choices.set(index, choice.finish_reason != null)
        const delta = object(choice.delta)
        append(texts, `text:${index}`, delta.content)
        append(texts, `refusal:${index}`, delta.refusal)
        if (delta.function_call) append(arguments_, `legacy:${index}`, object(delta.function_call).arguments)
        if (delta.tool_calls) {
          if (!Array.isArray(delta.tool_calls)) throw new Error('Invalid tool calls')
          for (const item of delta.tool_calls) {
            const call = object(item)
            if (!Number.isInteger(call.index)) throw new Error('Missing tool index')
            if (call.function) append(arguments_, `${index}:${call.index}`, object(call.function).arguments)
          }
        }
      }
    } else if (path.startsWith('/v1/responses')) {
      if (typeof event.type !== 'string' || !event.type.startsWith('response.'))
        throw new Error('Invalid Response event')
      if (event.type === 'response.failed') throw new Error('Failed Response')
      if (event.type.endsWith('.delta') && typeof event.delta === 'string') {
        const key = `${event.type}:${event.item_id}:${event.output_index}:${event.content_index}`
        append(event.type === 'response.function_call_arguments.delta' ? arguments_ : texts, key, event.delta)
      }
      if (event.type === 'response.function_call_arguments.done' && typeof event.arguments === 'string') {
        object(safeJson(event.arguments, assertSafe))
      }
      if (event.type === 'response.completed' || event.type === 'response.incomplete') {
        const response = object(event.response)
        if (response.status !== event.type.slice('response.'.length)) throw new Error('Inconsistent Response status')
        checkArguments(response, assertSafe)
        done = true
      }
    } else if (path === '/v1/audio/transcriptions') {
      if (event.type === 'transcript.text.delta') append(texts, 'transcript', event.delta)
      else if (event.type === 'transcript.text.segment') {
        if (typeof event.text !== 'string') throw new Error('Missing transcript segment')
        append(texts, 'segments', event.text)
      } else if (event.type === 'transcript.text.done') done = true
      else throw new Error('Unsupported transcription event')
    } else throw new Error('Unsupported OpenAI stream')
  }
  for (const value of texts.values()) assertSafe(value)
  for (const value of arguments_.values()) object(safeJson(value, assertSafe))
  if (!done) throw new Error('Incomplete OpenAI stream')
  return chunks
}
