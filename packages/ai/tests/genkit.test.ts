import { genkit, z } from 'genkit'
import { enableTelemetry, flushTracing } from 'genkit/tracing'
import { PostHog } from 'posthog-node'
import { PostHogGenkitSpanProcessor } from '../src/genkit'

// Genkit sets up OpenTelemetry once per process, so one forwarding processor is registered
// and each test swaps in the PostHog processor it needs.
let processor: PostHogGenkitSpanProcessor | undefined

beforeAll(async () => {
  await enableTelemetry({
    spanProcessors: [
      {
        onStart: () => {},
        onEnd: (span) => processor?.onEnd(span),
        forceFlush: async () => processor?.forceFlush(),
        shutdown: async () => {},
      },
    ],
  })
})

function createMockClient(): any {
  return {
    capture: vi.fn(),
    captureImmediate: vi.fn().mockResolvedValue(undefined),
    flush: vi.fn().mockResolvedValue(undefined),
  }
}

function capturedEvents(client: any): any[] {
  return client.capture.mock.calls.map(([event]: any[]) => event)
}

/** A flow that asks a fake model for the weather. The model calls one tool, then answers. */
function createWeatherFlow() {
  const ai = genkit({})
  const getWeather = ai.defineTool(
    {
      name: 'getWeather',
      description: 'Get the weather for a city',
      inputSchema: z.object({ city: z.string() }),
      outputSchema: z.string(),
    },
    async ({ city }) => `Sunny in ${city}`
  )
  ai.defineModel({ name: 'fake/weather-model', supports: { tools: true, media: true } }, async (request) => {
    if (request.messages.at(-1)?.role !== 'tool') {
      return {
        message: {
          role: 'model',
          content: [{ toolRequest: { name: 'getWeather', ref: 'call_1', input: { city: 'Paris' } } }],
        },
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5, cachedContentTokens: 2 },
      }
    }
    return {
      message: { role: 'model', content: [{ text: 'It is sunny in Paris.' }] },
      finishReason: 'stop',
      usage: { inputTokens: 20, outputTokens: 7, thoughtsTokens: 3 },
    }
  })
  return ai.defineFlow({ name: 'weatherFlow', inputSchema: z.string(), outputSchema: z.string() }, async (city) => {
    const { text } = await ai.generate({
      model: 'fake/weather-model',
      system: 'Be brief.',
      prompt: `What is the weather in ${city}?`,
      tools: [getWeather],
      config: { temperature: 0.2, apiKey: 'secret' },
    })
    return text
  })
}

describe('PostHogGenkitSpanProcessor', () => {
  let client: any

  beforeEach(() => {
    client = createMockClient()
    processor = new PostHogGenkitSpanProcessor({ client, distinctId: 'user_123' })
  })

  it('captures a flow as a trace with generations and spans', async () => {
    await expect(createWeatherFlow()('Paris')).resolves.toBe('It is sunny in Paris.')

    const events = capturedEvents(client)
    expect(events.map((event) => [event.event, event.properties.$ai_span_name])).toEqual([
      ['$ai_generation', 'fake/weather-model'],
      ['$ai_span', 'getWeather'],
      ['$ai_generation', 'fake/weather-model'],
      ['$ai_span', 'generate'],
      ['$ai_span', 'generate'],
      ['$ai_trace', 'weatherFlow'],
    ])

    const [firstGeneration, tool, , innerGenerate, outerGenerate, trace] = events
    const traceId = trace.properties.$ai_trace_id
    expect(traceId).toMatch(/^[0-9a-f]{32}$/)
    for (const event of events) {
      expect(event.distinctId).toBe('user_123')
      expect(event.properties.$ai_trace_id).toBe(traceId)
      expect(event.properties.$ai_framework).toBe('genkit')
      expect(event.properties.$ai_latency).toBeGreaterThanOrEqual(0)
    }

    expect(trace.properties.$ai_parent_id).toBeUndefined()
    expect(trace.properties.$ai_input_state).toBe('Paris')
    expect(trace.properties.$ai_output_state).toBe('It is sunny in Paris.')
    expect(outerGenerate.properties.$ai_parent_id).toBe(trace.properties.$ai_span_id)
    expect(innerGenerate.properties.$ai_parent_id).toBe(outerGenerate.properties.$ai_span_id)
    expect(firstGeneration.properties.$ai_parent_id).toBe(outerGenerate.properties.$ai_span_id)
    expect(tool.properties.$ai_parent_id).toBe(outerGenerate.properties.$ai_span_id)
  })

  it('maps a model call to $ai_generation', async () => {
    await createWeatherFlow()('Paris')

    const { properties } = capturedEvents(client)[0]
    expect(properties).toMatchObject({
      $ai_provider: 'fake',
      $ai_model: 'weather-model',
      $ai_input: [
        { role: 'system', content: [{ type: 'text', text: 'Be brief.' }] },
        { role: 'user', content: [{ type: 'text', text: 'What is the weather in Paris?' }] },
      ],
      $ai_output_choices: [
        {
          role: 'assistant',
          content: [{ type: 'function', id: 'call_1', function: { name: 'getWeather', arguments: { city: 'Paris' } } }],
        },
      ],
      $ai_input_tokens: 10,
      $ai_output_tokens: 5,
      $ai_cache_read_input_tokens: 2,
      $ai_stop_reason: 'stop',
      $ai_model_parameters: { temperature: 0.2 },
      $ai_http_status: 200,
    })
    expect(properties.$ai_tools).toEqual([expect.objectContaining({ name: 'getWeather' })])
  })

  it('includes tool results in the next generation input', async () => {
    await createWeatherFlow()('Paris')

    const { properties } = capturedEvents(client)[2]
    expect(properties.$ai_input.slice(2)).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'function', id: 'call_1', function: { name: 'getWeather', arguments: { city: 'Paris' } } }],
      },
      {
        role: 'tool',
        content: [{ type: 'tool_result', tool_use_id: 'call_1', name: 'getWeather', content: 'Sunny in Paris' }],
      },
    ])
    expect(properties.$ai_output_choices).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'It is sunny in Paris.' }] },
    ])
    expect(properties.$ai_reasoning_tokens).toBe(3)
  })

  it('maps a tool call to $ai_span', async () => {
    await createWeatherFlow()('Paris')

    expect(capturedEvents(client)[1].properties).toMatchObject({
      $ai_span_name: 'getWeather',
      $ai_span_type: 'tool',
      $ai_input_state: { city: 'Paris' },
      $ai_output_state: 'Sunny in Paris',
    })
  })

  it('captures one generation with the full output for a streamed call', async () => {
    const ai = genkit({})
    ai.defineModel({ name: 'fake/streaming-model' }, async (_request, sendChunk) => {
      sendChunk?.({ content: [{ text: 'Hello' }] })
      sendChunk?.({ content: [{ text: ' world' }] })
      return {
        message: { role: 'model', content: [{ text: 'Hello world' }] },
        finishReason: 'stop',
        usage: { inputTokens: 4, outputTokens: 2 },
      }
    })

    const { stream, response } = ai.generateStream({ model: 'fake/streaming-model', prompt: 'Say hello' })
    const chunks: string[] = []
    for await (const chunk of stream) {
      chunks.push(chunk.text)
    }
    await response

    expect(chunks).toEqual(['Hello', ' world'])
    const generations = capturedEvents(client).filter((event) => event.event === '$ai_generation')
    expect(generations).toHaveLength(1)
    expect(generations[0].properties).toMatchObject({
      $ai_output_choices: [{ role: 'assistant', content: [{ type: 'text', text: 'Hello world' }] }],
      $ai_input_tokens: 4,
      $ai_output_tokens: 2,
    })
  })

  // @genkit-ai/google-genai still returns the older `candidates` response shape.
  it('reads the output from candidates when the model response has no message', async () => {
    const ai = genkit({})
    ai.defineModel({ name: 'fake/candidates-model' }, async () => ({
      candidates: [{ index: 0, message: { role: 'model', content: [{ text: 'Hi there' }] }, finishReason: 'stop' }],
      usage: { inputTokens: 3, outputTokens: 2 },
    }))

    await ai.generate({ model: 'fake/candidates-model', prompt: 'Say hi' })

    const generation = capturedEvents(client).find((event) => event.event === '$ai_generation')
    expect(generation.properties).toMatchObject({
      $ai_output_choices: [{ role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] }],
      $ai_stop_reason: 'stop',
    })
  })

  it('captures model errors on the generation and the trace', async () => {
    const ai = genkit({})
    ai.defineModel({ name: 'fake/failing-model' }, async () => {
      throw new Error('quota exceeded')
    })
    const flow = ai.defineFlow('failingFlow', async () => {
      const { text } = await ai.generate({ model: 'fake/failing-model', prompt: 'Hi' })
      return text
    })

    await expect(flow()).rejects.toThrow('quota exceeded')

    const events = capturedEvents(client)
    const generation = events.find((event) => event.event === '$ai_generation')
    expect(generation.properties).toMatchObject({ $ai_is_error: true, $ai_http_status: 500 })
    expect(JSON.parse(generation.properties.$ai_error)).toEqual({
      name: 'Error',
      message: 'quota exceeded',
      stack: expect.stringContaining('genkit.test.ts'),
    })
    expect(generation.properties.$ai_output_choices).toEqual([])
    const trace = events.find((event) => event.event === '$ai_trace')
    expect(trace.properties.$ai_is_error).toBe(true)
    expect(trace.properties.$ai_span_name).toBe('failingFlow')
  })

  it('sends model errors to exception autocapture as an Error with the original stack', async () => {
    client.options = { enableExceptionAutocapture: true }
    client.captureException = vi.fn()
    const ai = genkit({})
    ai.defineModel({ name: 'fake/failing-model' }, async () => {
      // OpenTelemetry records the code, not the class name, as the exception type.
      throw Object.assign(new TypeError('bad request'), { code: 400 })
    })

    await expect(ai.generate({ model: 'fake/failing-model', prompt: 'Hi' })).rejects.toThrow('bad request')

    expect(client.captureException).toHaveBeenCalledTimes(1)
    const [error] = client.captureException.mock.calls[0]
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ name: 'TypeError', message: 'bad request' })
    expect(error.stack).toContain('genkit.test.ts')
  })

  it('leaves out inputs and outputs in privacy mode', async () => {
    processor = new PostHogGenkitSpanProcessor({ client, privacyMode: true })

    await createWeatherFlow()('Paris')

    for (const { properties } of capturedEvents(client)) {
      expect(properties.$ai_input ?? null).toBeNull()
      expect(properties.$ai_output_choices ?? null).toBeNull()
      expect(properties.$ai_input_state ?? null).toBeNull()
      expect(properties.$ai_output_state ?? null).toBeNull()
    }
    expect(capturedEvents(client)[0].properties.$ai_input_tokens).toBe(10)
  })

  it('maps media parts to image and inline data blocks, and redacts base64 data', async () => {
    const ai = genkit({})
    ai.defineModel({ name: 'fake/vision-model', supports: { media: true } }, async () => ({
      message: { role: 'model', content: [{ text: 'A red pixel.' }] },
      finishReason: 'stop',
    }))
    const image = `data:image/png;base64,${'iVBORw0KGgo'.repeat(20)}`

    await ai.generate({
      model: 'fake/vision-model',
      prompt: [
        { text: 'Describe these files.' },
        { media: { url: image, contentType: 'image/png' } },
        { media: { url: 'https://example.com/cat.jpg' } },
        { media: { url: 'data:application/pdf;base64,JVBERi0xLjQK', contentType: 'application/pdf' } },
        { media: { url: 'gs://bucket/talk.mp3', contentType: 'audio/mpeg' } },
      ],
    })

    const generation = capturedEvents(client).find((event) => event.event === '$ai_generation')
    expect(generation.properties.$ai_input[0].content.slice(1)).toEqual([
      { type: 'image', inline_data: { mime_type: 'image/png', data: '[base64 image/png redacted]' } },
      { type: 'image', image: 'https://example.com/cat.jpg' },
      { type: 'document', inline_data: { mime_type: 'application/pdf', data: '[base64 application/pdf redacted]' } },
      { media: { url: 'gs://bucket/talk.mp3', contentType: 'audio/mpeg' } },
    ])
  })

  it('keeps credentials in plugin config out of every event', async () => {
    await createWeatherFlow()('Paris')

    const events = capturedEvents(client)
    expect(JSON.stringify(events)).not.toContain('secret')
    const generate = events.find((event) => event.properties.$ai_span_name === 'generate')
    expect(generate.properties.$ai_input_state.config).toEqual({ temperature: 0.2, apiKey: '[REDACTED]' })
    expect(generate.properties.$ai_output_state.request.config).toEqual({ temperature: 0.2, apiKey: '[REDACTED]' })
  })

  it.each([
    ['googleai/gemini-2.5-flash', 'gemini', 'gemini-2.5-flash'],
    ['vertexai/gemini-2.5-flash', 'vertex', 'gemini-2.5-flash'],
    ['ollama/llama3', 'ollama', 'llama3'],
  ])('sends the provider of %s as %s', async (name, provider, model) => {
    const ai = genkit({})
    ai.defineModel({ name }, async () => ({ message: { role: 'model', content: [{ text: 'Hi' }] } }))

    await ai.generate({ model: name, prompt: 'Hi' })

    const generation = capturedEvents(client).find((event) => event.event === '$ai_generation')
    expect(generation.properties).toMatchObject({ $ai_provider: provider, $ai_model: model })
  })

  it('captures an embedder call as $ai_embedding without the vectors or credentials', async () => {
    const ai = genkit({})
    const embedder = ai.defineEmbedder({ name: 'googleai/text-embedding-004' }, async (documents) => ({
      embeddings: documents.map(() => ({ embedding: [0.25, 0.5] })),
    }))

    await ai.embedMany({ embedder, content: ['first document', 'second document'], options: { apiKey: 'secret' } })

    const events = capturedEvents(client)
    expect(events.map((event) => event.event)).toEqual(['$ai_embedding'])
    expect(events[0].properties).toMatchObject({
      $ai_provider: 'gemini',
      $ai_model: 'text-embedding-004',
      $ai_input: ['first document', 'second document'],
      $ai_framework: 'genkit',
    })
    expect(events[0].properties.$ai_output_choices ?? null).toBeNull()
    expect(JSON.stringify(events)).not.toContain('secret')
    expect(JSON.stringify(events)).not.toContain('0.25')
  })

  it('adds groups and properties, and captures personless events without a distinct ID', async () => {
    processor = new PostHogGenkitSpanProcessor({ client, groups: { company: 'acme' }, properties: { env: 'test' } })

    await createWeatherFlow()('Paris')

    for (const event of capturedEvents(client)) {
      expect(event.distinctId).toBe(event.properties.$ai_trace_id)
      expect(event.groups).toEqual({ company: 'acme' })
      expect(event.properties).toMatchObject({ env: 'test', $process_person_profile: false })
    }
  })

  it('uses the distinct ID from the PostHog context', async () => {
    const posthog = new PostHog('phc_test', { host: 'http://127.0.0.1:9', flushAt: 1000 })
    const capture = vi.spyOn(posthog, 'capture').mockImplementation(() => {})
    processor = new PostHogGenkitSpanProcessor({ client: posthog })

    await posthog.withContext({ distinctId: 'context_user' }, () => createWeatherFlow()('Paris'))

    expect(capture).toHaveBeenCalledTimes(6)
    for (const [event] of capture.mock.calls) {
      expect(event.distinctId).toBe('context_user')
    }
    await posthog.shutdown()
  })

  it('reports capture failures to onError without failing the flow', async () => {
    const onError = vi.fn()
    const failure = new Error('capture failed')
    client.capture.mockImplementation(() => {
      throw failure
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    processor = new PostHogGenkitSpanProcessor({ client, onError })

    await expect(createWeatherFlow()('Paris')).resolves.toBe('It is sunny in Paris.')

    expect(onError).toHaveBeenCalledTimes(6)
    expect(onError).toHaveBeenCalledWith(failure)
  })

  it('flushes the PostHog client from flushTracing and reports flush failures', async () => {
    const onError = vi.fn()
    const failure = new Error('network down')
    client.flush.mockRejectedValueOnce(failure)
    processor = new PostHogGenkitSpanProcessor({ client, onError })

    await expect(flushTracing()).resolves.toBeUndefined()

    expect(client.flush).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(failure)
  })

  it('ignores spans that do not come from Genkit', () => {
    processor!.onEnd({
      name: 'GET /health',
      attributes: { 'http.method': 'GET' },
      duration: [0, 1000],
      status: { code: 0 },
      spanContext: () => ({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) }),
    })

    expect(client.capture).not.toHaveBeenCalled()
  })
})
