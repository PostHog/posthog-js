export const geminiInteractionsPath = '/v1beta/interactions'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Gemini interaction object')
  return value as Record<string, unknown>
}

function terminal(value: unknown): boolean {
  return value === 'completed' || value === 'requires_action'
}

export function validateGeminiInteractionJSON(value: unknown, assertSafe: (value: unknown) => void): void {
  const interaction = object(value)
  assertSafe(interaction)
  if (
    (interaction.id !== undefined && (typeof interaction.id !== 'string' || !interaction.id)) ||
    !terminal(interaction.status) ||
    !Array.isArray(interaction.steps) ||
    !interaction.steps.length
  ) {
    throw new Error('Incomplete Gemini interaction')
  }
  for (const item of interaction.steps) {
    const step = object(item)
    if (step.type !== 'model_output' && step.type !== 'function_call' && step.type !== 'thought')
      throw new Error('Unsupported Gemini interaction step')
    if (step.type === 'function_call' && (typeof step.id !== 'string' || typeof step.name !== 'string'))
      throw new Error('Invalid Gemini function call')
  }
}

export function geminiInteractionStreamChunks(
  text: string,
  parseJSON: (text: string) => unknown,
  assertSafe: (value: unknown) => void
): string[] {
  assertSafe(text)
  const normalized = text.replace(/\r\n?/g, '\n')
  if (!normalized.endsWith('\n\n')) throw new Error('Incomplete Gemini interaction SSE frame')
  const chunks = normalized
    .slice(0, -2)
    .split('\n\n')
    .map((chunk) => `${chunk}\n\n`)
  let interactionId: string | undefined
  let created = false
  let completed = false
  let done = false
  let nextIndex = 0
  let openStep:
    | { index: number; type: string; text: string; arguments: string; thought: string; signature: string }
    | undefined
  let output = ''
  for (const chunk of chunks) {
    if (done) throw new Error('Gemini interaction event after done')
    const lines = chunk.trimEnd().split('\n')
    const eventName = lines
      .find((line) => line.startsWith('event:'))
      ?.slice(6)
      .trim()
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!eventName || !data) throw new Error('Invalid Gemini interaction SSE frame')
    if (eventName === 'done') {
      if (data !== '[DONE]' || !completed) throw new Error('Incomplete Gemini interaction stream')
      done = true
      continue
    }
    const event = object(parseJSON(data))
    assertSafe(event)
    if (event.event_type !== eventName || completed) throw new Error('Invalid Gemini interaction event')
    if (eventName === 'interaction.created') {
      if (created) throw new Error('Duplicate Gemini interaction start')
      const interaction = object(event.interaction)
      if (
        typeof interaction.id !== 'string' ||
        (interaction.status !== 'in_progress' && interaction.status !== 'queued')
      )
        throw new Error('Invalid Gemini interaction start')
      interactionId = interaction.id
      created = true
    } else {
      if (!created) throw new Error('Missing Gemini interaction start')
      if (eventName === 'interaction.status_update') {
        if (event.interaction_id !== interactionId) throw new Error('Mismatched Gemini interaction ID')
      } else if (eventName === 'step.start') {
        if (openStep || event.index !== nextIndex) throw new Error('Invalid Gemini interaction step order')
        const step = object(event.step)
        if (step.type !== 'model_output' && step.type !== 'function_call' && step.type !== 'thought')
          throw new Error('Unsupported Gemini interaction step')
        if (step.type === 'function_call' && (typeof step.id !== 'string' || typeof step.name !== 'string'))
          throw new Error('Invalid Gemini function call')
        openStep = { index: nextIndex++, type: step.type, text: '', arguments: '', thought: '', signature: '' }
      } else if (eventName === 'step.delta') {
        if (!openStep || event.index !== openStep.index) throw new Error('Gemini interaction delta without step')
        const delta = object(event.delta)
        if (delta.type === 'text') {
          if (openStep.type !== 'model_output' || typeof delta.text !== 'string')
            throw new Error('Invalid Gemini interaction text delta')
          openStep.text += delta.text
          output += delta.text
          assertSafe(openStep.text)
          assertSafe(output)
        } else if (delta.type === 'arguments_delta') {
          if (openStep.type !== 'function_call' || typeof delta.arguments !== 'string')
            throw new Error('Invalid Gemini interaction arguments delta')
          openStep.arguments += delta.arguments
          assertSafe(openStep.arguments)
        } else if (delta.type === 'thought_summary') {
          const content = object(delta.content)
          if (openStep.type !== 'thought' || content.type !== 'text' || typeof content.text !== 'string')
            throw new Error('Invalid Gemini thought summary')
          openStep.thought += content.text
          assertSafe(openStep.thought)
        } else if (delta.type === 'thought_signature') {
          if (typeof delta.signature !== 'string') throw new Error('Invalid Gemini thought signature')
          openStep.signature += delta.signature
          assertSafe(openStep.signature)
        } else {
          throw new Error('Unsupported Gemini interaction delta')
        }
      } else if (eventName === 'step.stop') {
        if (!openStep || event.index !== openStep.index) throw new Error('Gemini interaction stop without step')
        if (openStep.type === 'function_call' && openStep.arguments) {
          const args = object(parseJSON(openStep.arguments))
          assertSafe(args)
        }
        openStep = undefined
      } else if (eventName === 'interaction.completed') {
        if (openStep || nextIndex === 0) throw new Error('Incomplete Gemini interaction steps')
        const interaction = object(event.interaction)
        if (interaction.id !== interactionId || !terminal(interaction.status))
          throw new Error('Invalid Gemini interaction completion')
        completed = true
      } else {
        throw new Error('Unsupported Gemini interaction event')
      }
    }
  }
  if (!done) throw new Error('Incomplete Gemini interaction stream')
  return chunks
}
