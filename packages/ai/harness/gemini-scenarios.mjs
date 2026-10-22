import { GoogleGenAI } from '@google/genai'

export const geminiOperations = ['generateContent', 'generateContentStream', 'embedContent', 'interactions.create']
export const geminiGroups = [
  'generate',
  'stream',
  'tools',
  'tools-stream',
  'embed',
  'interaction',
  'interaction-stream',
  'interaction-tools',
  'interaction-tools-stream',
]

export function geminiScenario(group, model) {
  if (!geminiGroups.includes(group) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model ?? '')) {
    throw new Error('Invalid Gemini recording selection')
  }
  if (group === 'embed') {
    return {
      name: 'gemini-embed',
      operation: 'embedContent',
      request: { model, contents: ['A blue triangle.', 'A red square.'], config: { outputDimensionality: 8 } },
    }
  }
  if (group.startsWith('interaction')) {
    const tools = group.includes('tools')
    const streaming = group.endsWith('stream')
    return {
      name: `gemini-${group}`,
      operation: 'interactions.create',
      request: {
        model,
        input: tools
          ? 'Call describe_shape for a blue triangle with three sides. Do not answer in text.'
          : 'Reply with a short greeting.',
        store: false,
        ...(streaming ? { stream: true } : {}),
        ...(tools
          ? {
              tools: [
                {
                  type: 'function',
                  name: 'describe_shape',
                  description: 'Describe an artificial shape.',
                  parameters: {
                    type: 'object',
                    properties: { color: { type: 'string' }, sides: { type: 'integer' } },
                    required: ['color', 'sides'],
                  },
                },
              ],
              generation_config: { tool_choice: 'any', max_output_tokens: 64, thinking_level: 'minimal' },
            }
          : { generation_config: { max_output_tokens: 64, thinking_level: 'minimal' } }),
      },
    }
  }
  const tools = group.startsWith('tools')
  const streaming = group.endsWith('stream')
  return {
    name: `gemini-${group}`,
    operation: streaming ? 'generateContentStream' : 'generateContent',
    request: {
      model,
      contents: tools ? 'Call describe_shape for a blue triangle with three sides.' : 'Reply with a short greeting.',
      config: {
        maxOutputTokens: 256,
        automaticFunctionCalling: { disable: true },
        ...(tools
          ? {
              tools: [
                {
                  functionDeclarations: [
                    {
                      name: 'describe_shape',
                      description: 'Describe an artificial shape.',
                      parameters: {
                        type: 'OBJECT',
                        properties: { color: { type: 'STRING' }, sides: { type: 'INTEGER' } },
                        required: ['color', 'sides'],
                      },
                    },
                  ],
                },
              ],
              toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['describe_shape'] } },
            }
          : {}),
      },
    },
  }
}

export function geminiClientOptions(url, apiKey, timeout = 10000) {
  return {
    apiKey,
    vertexai: false,
    httpOptions: { baseUrl: url, apiVersion: 'v1beta', timeout, retryOptions: { attempts: 1 } },
  }
}

export function generationResult(response) {
  // The SDK text getter logs unknown part names, which can contain untrusted data.
  const textParts = response.candidates?.[0]?.content?.parts?.filter(
    (part) => typeof part.text === 'string' && part.thought !== true
  )
  return {
    text: textParts?.length ? textParts.map((part) => part.text).join('') : undefined,
    candidates: response.candidates,
    usageMetadata: response.usageMetadata,
    promptFeedback: response.promptFeedback,
  }
}

export function interactionResult(response) {
  return {
    id: response.id,
    model: response.model,
    status: response.status,
    steps: response.steps,
    usage: response.usage,
    output_text: response.output_text,
  }
}

export async function consumeGemini(url, apiKey, scenario) {
  const client = new GoogleGenAI(
    geminiClientOptions(url, apiKey, scenario.operation === 'interactions.create' ? 60000 : 10000)
  )
  if (scenario.operation === 'interactions.create') {
    const result = await client.interactions.create(scenario.request)
    if (scenario.request.stream) {
      const events = []
      for await (const event of result) events.push(event)
      return events
    }
    return interactionResult(result)
  }
  if (scenario.operation === 'generateContentStream') {
    const chunks = []
    for await (const chunk of await client.models.generateContentStream(scenario.request))
      chunks.push(generationResult(chunk))
    return chunks
  }
  if (scenario.operation === 'embedContent')
    return { embeddings: (await client.models.embedContent(scenario.request)).embeddings }
  return generationResult(await client.models.generateContent(scenario.request))
}

export function verifyGeminiRecording(scenario, result) {
  if (scenario.operation === 'interactions.create') {
    const interaction = Array.isArray(result)
      ? result.findLast((event) => event.event_type === 'interaction.completed')?.interaction
      : result
    if (!interaction || !['completed', 'requires_action'].includes(interaction.status) || !interaction.usage)
      throw new Error('Unexpected interaction completion')
    if (scenario.name.includes('tools')) {
      const calls = Array.isArray(result)
        ? result.filter((event) => event.event_type === 'step.start').map((event) => event.step)
        : result.steps
      if (!calls?.some((step) => step.type === 'function_call' && step.name === 'describe_shape' && step.id))
        throw new Error('Missing interaction function call')
    } else {
      const text = Array.isArray(result)
        ? result
            .filter((event) => event.event_type === 'step.delta' && event.delta.type === 'text')
            .map((event) => event.delta.text)
            .join('')
        : result.output_text
      if (!text) throw new Error('Missing interaction text')
    }
    return
  }
  if (scenario.operation === 'embedContent') {
    if (result.embeddings?.length !== 2 || result.embeddings.some((item) => item.values?.length !== 8))
      throw new Error('Unexpected embedding result')
    return
  }
  const chunks = Array.isArray(result) ? result : [result]
  const finalCandidate = chunks
    .flatMap((chunk) => chunk.candidates ?? [])
    .findLast((candidate) => candidate.finishReason)
  if (!finalCandidate || finalCandidate.finishReason !== 'STOP') throw new Error('Unexpected generation completion')
  if (scenario.name.includes('tools')) {
    const calls = chunks
      .flatMap((chunk) => (chunk.candidates ?? []).flatMap((candidate) => candidate.content?.parts ?? []))
      .filter((part) => part.functionCall)
    if (
      calls.length !== 1 ||
      calls[0].functionCall.name !== 'describe_shape' ||
      calls[0].functionCall.args?.color !== 'blue' ||
      calls[0].functionCall.args?.sides !== 3
    )
      throw new Error('Unexpected function call')
  } else if (!chunks.some((chunk) => chunk.text)) {
    throw new Error('Missing generated text')
  }
}
