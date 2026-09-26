import { PostHog } from 'posthog-node'
import { PostHogGoogleGenAI } from '../src/gemini'

const provider = vi.hoisted(() => ({
  create: vi.fn(),
  generateContent: vi.fn(),
}))

vi.mock('posthog-node', () => ({
  PostHog: vi.fn().mockImplementation(() => ({
    capture: vi.fn(),
    captureImmediate: vi.fn(),
    privacyMode: false,
  })),
}))

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    interactions = { create: provider.create }
    models = { generateContent: provider.generateContent }
  },
}))

const textInteraction = {
  id: 'v1_text',
  model: 'gemini-3.8-flash',
  status: 'completed',
  output_text: 'Hello!',
  steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Hello!' }] }],
  usage: {
    total_input_tokens: 12,
    total_output_tokens: 5,
    total_cached_tokens: 4,
    total_thought_tokens: 2,
    total_tokens: 17,
  },
}

function captured(client: PostHog) {
  expect(client.capture).toHaveBeenCalledTimes(1)
  return (client.capture as vi.Mock).mock.calls[0][0]
}

function setup() {
  const posthog = new PostHog('test-key')
  const gemini = new PostHogGoogleGenAI({ apiKey: 'test-api-key', posthog })
  return { posthog, gemini }
}

describe('Gemini Interactions API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('passes the exact provider request, omits monitoring fields, and captures one unary turn', async () => {
    const { posthog, gemini } = setup()
    provider.create.mockResolvedValue(textInteraction)
    const request = {
      model: 'gemini-3.8-flash',
      input: 'Say hello',
      store: false,
      previous_interaction_id: 'v1_previous',
      posthogDistinctId: 'user-1',
      posthogProperties: { source: 'interaction-test' },
    }

    const result = await (gemini as any).interactions.create(request)

    expect(result).toBe(textInteraction)
    expect(provider.create).toHaveBeenCalledTimes(1)
    expect(provider.create).toHaveBeenCalledWith({
      model: 'gemini-3.8-flash',
      input: 'Say hello',
      store: false,
      previous_interaction_id: 'v1_previous',
    })
    const event = captured(posthog)
    expect(event.event).toBe('$ai_generation')
    expect(event.distinctId).toBe('user-1')
    expect(event.properties).toMatchObject({
      $ai_provider: 'gemini',
      $ai_model: 'gemini-3.8-flash',
      $ai_completion_id: 'v1_text',
      $ai_input_tokens: 12,
      $ai_output_tokens: 5,
      $ai_cache_read_input_tokens: 4,
      $ai_cache_reporting_exclusive: false,
      $ai_reasoning_tokens: 2,
      $ai_usage: textInteraction.usage,
      source: 'interaction-test',
    })
    expect(event.properties.$ai_input).toEqual([{ role: 'user', content: 'Say hello' }])
    expect(event.properties.$ai_output_choices).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] },
    ])
  })

  test('passes SDK request options as the second provider argument', async () => {
    const { gemini } = setup()
    provider.create.mockResolvedValue(textInteraction)
    const options = { timeout: 1000, maxRetries: 0 }

    await (gemini as any).interactions.create({ model: 'gemini-3.8-flash', input: 'Hello' }, options)

    expect(provider.create).toHaveBeenCalledTimes(1)
    expect(provider.create).toHaveBeenCalledWith({ model: 'gemini-3.8-flash', input: 'Hello' }, options)
  })

  test('does not invent a completion id for a stateless provider response', async () => {
    const { posthog, gemini } = setup()
    provider.create.mockResolvedValue({
      model: 'gemini-3.1-flash-lite',
      status: 'completed',
      steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Hello' }] }],
      usage: { total_input_tokens: 4, total_output_tokens: 2 },
    })

    await gemini.interactions.create({ model: 'gemini-3.1-flash-lite', input: 'Hello', store: false })

    expect(captured(posthog).properties.$ai_completion_id).toBeUndefined()
    expect((posthog.capture as vi.Mock).mock.calls[0][0].properties.$ai_input_tokens).toBe(4)
  })

  test('records the actual Interactions generation settings', async () => {
    const { posthog, gemini } = setup()
    provider.create.mockResolvedValue(textInteraction)

    await gemini.interactions.create({
      model: 'gemini-3.8-flash',
      input: 'Hello',
      generation_config: { max_output_tokens: 128, thinking_level: 'LOW' },
    })

    expect(captured(posthog).properties.$ai_model_parameters).toEqual({ max_tokens: 128, thinking_level: 'LOW' })
  })

  test.each([
    { model: 'gemini-3.8-flash', input: 'Hello', background: true },
    { agent: 'my-agent', input: 'Hello' },
  ])('rejects unsupported lifecycle modes before calling the provider', async (request) => {
    const { posthog, gemini } = setup()

    await expect((gemini.interactions.create as any)(request)).rejects.toThrow(/foreground model calls only/)

    expect(provider.create).not.toHaveBeenCalled()
    expect(posthog.capture).not.toHaveBeenCalled()
  })

  test('does not report a queued response as a completed generation', async () => {
    const { posthog, gemini } = setup()
    const queued = { id: 'v1_queued', model: 'gemini-3.8-flash', status: 'queued' }
    provider.create.mockResolvedValue(queued)

    expect(await gemini.interactions.create({ model: 'gemini-3.8-flash', input: 'Hello' })).toBe(queued)
    expect(posthog.capture).not.toHaveBeenCalled()
  })

  test.each([
    ['gemini-2.5-flash', 1],
    ['gemini-3.8-flash', 3],
    ['models/gemini-2.5-flash', 1],
    ['models/gemini-3.8-flash', 3],
  ])('prices %s grounding according to its billing unit', async (model, expected) => {
    const { posthog, gemini } = setup()
    provider.create.mockResolvedValue({
      ...textInteraction,
      model,
      usage: { ...textInteraction.usage, grounding_tool_count: [{ type: 'google_search', count: 3 }] },
    })

    await gemini.interactions.create({ model, input: 'Search' })

    expect(captured(posthog).properties.$ai_web_search_count).toBe(expected)
  })

  test('never sends MCP server credentials or URLs to PostHog', async () => {
    const { posthog, gemini } = setup()
    provider.create.mockResolvedValue(textInteraction)
    const tool = {
      type: 'mcp_server' as const,
      name: 'private-tools',
      url: 'https://example.com/mcp?key=secret-in-url',
      headers: { Authorization: 'Bearer secret-in-header' },
    }

    await gemini.interactions.create({ model: 'gemini-3.8-flash', input: 'Hello', tools: [tool] })

    expect(provider.create).toHaveBeenCalledWith({ model: 'gemini-3.8-flash', input: 'Hello', tools: [tool] })
    expect(captured(posthog).properties.$ai_tools).toEqual([{ type: 'mcp_server', name: 'private-tools' }])
    expect(JSON.stringify((posthog.capture as vi.Mock).mock.calls)).not.toContain('secret-in-')
  })

  test('never sends retrieval tool API keys or custom configuration to PostHog', async () => {
    const { posthog, gemini } = setup()
    provider.create.mockResolvedValue(textInteraction)
    const tool = {
      type: 'retrieval' as const,
      exa_ai_search_config: { api_key: 'exa-secret', custom_config: { token: 'custom-secret' } },
      parallel_ai_search_config: { api_key: 'parallel-secret' },
    }

    await gemini.interactions.create({ model: 'gemini-3.8-flash', input: 'Hello', tools: [tool] })

    expect(provider.create).toHaveBeenCalledWith({ model: 'gemini-3.8-flash', input: 'Hello', tools: [tool] })
    expect(captured(posthog).properties.$ai_tools).toEqual([{ type: 'retrieval' }])
    expect(JSON.stringify((posthog.capture as vi.Mock).mock.calls)).not.toContain('secret')
  })

  test('records client-side tool calls and result inputs with their matching call id', async () => {
    const { posthog, gemini } = setup()
    const functionCall = {
      id: 'call_weather',
      type: 'function_call',
      name: 'get_weather',
      arguments: { city: 'Paris' },
    }
    provider.create.mockResolvedValue({
      id: 'v1_tool',
      model: 'gemini-3.8-flash',
      status: 'requires_action',
      steps: [functionCall],
      usage: { total_input_tokens: 20, total_output_tokens: 4 },
    })

    await (gemini as any).interactions.create({
      model: 'gemini-3.8-flash',
      input: [
        {
          type: 'function_result',
          name: 'previous_tool',
          call_id: 'call_previous',
          result: [{ type: 'text', text: 'done' }],
        },
      ],
      tools: [{ type: 'function', name: 'get_weather', parameters: { type: 'object' } }],
      posthogDistinctId: 'user-1',
    })

    const properties = captured(posthog).properties
    expect(properties.$ai_completion_id).toBe('v1_tool')
    expect(properties.$ai_stop_reason).toBe('requires_action')
    expect(properties.$ai_input).toEqual([
      {
        role: 'tool',
        content: [
          {
            type: 'function_result',
            name: 'previous_tool',
            call_id: 'call_previous',
            result: [{ type: 'text', text: 'done' }],
          },
        ],
      },
    ])
    expect(properties.$ai_output_choices).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'function', id: 'call_weather', function: { name: 'get_weather', arguments: { city: 'Paris' } } },
        ],
      },
    ])
    expect(properties.$ai_tools).toEqual([{ type: 'function', name: 'get_weather' }])
  })

  test('preserves stream events and assembles text and split tool arguments without summing interim usage', async () => {
    const { posthog, gemini } = setup()
    const events = [
      {
        event_type: 'interaction.created',
        interaction: { id: 'v1_stream', model: 'gemini-3.8-flash', status: 'in_progress' },
      },
      { event_type: 'step.start', index: 0, step: { type: 'model_output' } },
      { event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'Hel' } },
      { event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'lo!' } },
      { event_type: 'step.stop', index: 0, usage: { total_input_tokens: 12, total_output_tokens: 2 } },
      {
        event_type: 'step.start',
        index: 1,
        step: { type: 'function_call', id: 'call_weather', name: 'get_weather', arguments: {} },
      },
      { event_type: 'step.delta', index: 1, delta: { type: 'arguments_delta', arguments: '{"city":' } },
      { event_type: 'step.delta', index: 1, delta: { type: 'arguments_delta', arguments: '"Paris"}' } },
      { event_type: 'step.stop', index: 1, usage: { total_input_tokens: 12, total_output_tokens: 3 } },
      {
        event_type: 'interaction.completed',
        interaction: {
          id: 'v1_stream',
          model: 'gemini-3.8-flash',
          status: 'requires_action',
          usage: { total_input_tokens: 12, total_output_tokens: 5, total_cached_tokens: 4 },
        },
      },
    ]
    provider.create.mockResolvedValue(
      (async function* () {
        yield* events
      })()
    )

    const stream = await (gemini as any).interactions.create({
      model: 'gemini-3.8-flash',
      input: 'Weather?',
      stream: true,
      posthogDistinctId: 'user-1',
    })
    const received = []
    for await (const event of stream) received.push(event)

    expect(received).toEqual(events)
    expect(provider.create).toHaveBeenCalledTimes(1)
    expect(provider.create).toHaveBeenCalledWith({ model: 'gemini-3.8-flash', input: 'Weather?', stream: true })
    const properties = captured(posthog).properties
    expect(properties.$ai_completion_id).toBe('v1_stream')
    expect(properties.$ai_input_tokens).toBe(12)
    expect(properties.$ai_output_tokens).toBe(5)
    expect(properties.$ai_cache_read_input_tokens).toBe(4)
    expect(properties.$ai_output_choices).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Hello!' },
          { type: 'function', id: 'call_weather', function: { name: 'get_weather', arguments: { city: 'Paris' } } },
        ],
      },
    ])
  })

  test('preserves the SDK readable-stream API and does not mutate received events', async () => {
    const { posthog, gemini } = setup()
    const start = {
      event_type: 'step.start',
      index: 0,
      step: { type: 'model_output', content: [{ type: 'text', text: 'A' }] },
    }
    provider.create.mockResolvedValue(
      (async function* () {
        yield { event_type: 'interaction.created', interaction: { id: 'v1_reader', model: 'gemini-3.8-flash' } }
        yield start
        yield { event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'B' } }
        yield {
          event_type: 'interaction.completed',
          interaction: {
            id: 'v1_reader',
            model: 'gemini-3.8-flash',
            status: 'completed',
            usage: { total_input_tokens: 2 },
          },
        }
      })()
    )

    const stream = await gemini.interactions.create({ model: 'gemini-3.8-flash', input: 'Hello', stream: true })
    expect(typeof stream.getReader).toBe('function')
    expect(typeof stream.tee).toBe('function')
    expect(typeof stream.cancel).toBe('function')
    const reader = stream.getReader()
    const received = []
    while (true) {
      const item = await reader.read()
      if (item.done) break
      received.push(item.value)
    }

    expect(received).toContain(start)
    expect(start.step.content).toEqual([{ type: 'text', text: 'A' }])
    expect(captured(posthog).properties.$ai_output_choices).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'AB' }] },
    ])
  })

  test('supports tee without duplicating telemetry', async () => {
    const { posthog, gemini } = setup()
    const events = [
      { event_type: 'interaction.created', interaction: { model: 'gemini-3.1-flash-lite' } },
      {
        event_type: 'interaction.completed',
        interaction: { model: 'gemini-3.1-flash-lite', status: 'completed', usage: { total_input_tokens: 2 } },
      },
    ]
    provider.create.mockResolvedValue(
      (async function* () {
        yield* events
      })()
    )

    const stream = await gemini.interactions.create({ model: 'gemini-3.1-flash-lite', input: 'Hello', stream: true })
    const [left, right] = stream.tee()
    const [receivedLeft, receivedRight] = await Promise.all([
      (async () => {
        const received = []
        for await (const event of left) received.push(event)
        return received
      })(),
      (async () => {
        const received = []
        for await (const event of right) received.push(event)
        return received
      })(),
    ])

    expect(receivedLeft).toEqual(events)
    expect(receivedRight).toEqual(events)
    expect(posthog.capture).toHaveBeenCalledTimes(1)
  })

  test('supports cancellation without reporting incomplete usage as complete', async () => {
    const { posthog, gemini } = setup()
    provider.create.mockResolvedValue(
      (async function* () {
        yield { event_type: 'interaction.created', interaction: { model: 'gemini-3.1-flash-lite' } }
        yield { event_type: 'step.start', index: 0, step: { type: 'model_output' } }
        yield {
          event_type: 'interaction.completed',
          interaction: { status: 'completed', usage: { total_input_tokens: 2 } },
        }
      })()
    )

    const stream = await gemini.interactions.create({ model: 'gemini-3.1-flash-lite', input: 'Hello', stream: true })
    const reader = stream.getReader()
    expect((await reader.read()).value?.event_type).toBe('interaction.created')
    await reader.cancel()

    expect(captured(posthog).properties.$ai_input_tokens).toBeUndefined()
    expect((posthog.capture as vi.Mock).mock.calls[0][0].properties.$ai_stop_reason).toBe('cancelled')
  })

  test('redacts telemetry only, without changing the provider request or result', async () => {
    const { posthog, gemini } = setup()
    provider.create.mockResolvedValue(textInteraction)
    const result = await (gemini as any).interactions.create({
      model: 'gemini-3.8-flash',
      input: 'secret prompt',
      posthogPrivacyMode: true,
    })

    expect(result).toBe(textInteraction)
    expect(provider.create).toHaveBeenCalledTimes(1)
    expect(provider.create).toHaveBeenCalledWith({ model: 'gemini-3.8-flash', input: 'secret prompt' })
    const properties = captured(posthog).properties
    expect(properties.$ai_input).toBeNull()
    expect(properties.$ai_output_choices).toBeNull()
    expect(properties.$ai_input_tokens).toBe(12)
    expect(properties.$ai_output_tokens).toBe(5)
  })

  test('applies default binary redaction to system instructions too', async () => {
    const { posthog, gemini } = setup()
    provider.create.mockResolvedValue(textInteraction)
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA'

    await gemini.interactions.create({ model: 'gemini-3.8-flash', input: 'Hello', system_instruction: image })

    expect(provider.create).toHaveBeenCalledWith({
      model: 'gemini-3.8-flash',
      input: 'Hello',
      system_instruction: image,
    })
    expect(JSON.stringify(captured(posthog).properties.$ai_input)).not.toContain(image)
  })

  test('redacts streamed output and tool arguments without changing the events', async () => {
    const { posthog, gemini } = setup()
    const events = [
      {
        event_type: 'interaction.created',
        interaction: { id: 'v1_private', model: 'gemini-3.8-flash', status: 'in_progress' },
      },
      {
        event_type: 'step.start',
        index: 0,
        step: { type: 'function_call', id: 'call_secret', name: 'lookup', arguments: {} },
      },
      { event_type: 'step.delta', index: 0, delta: { type: 'arguments_delta', arguments: '{"secret":"private"}' } },
      { event_type: 'step.stop', index: 0 },
      {
        event_type: 'interaction.completed',
        interaction: {
          id: 'v1_private',
          model: 'gemini-3.8-flash',
          status: 'requires_action',
          usage: { total_input_tokens: 7 },
        },
      },
    ]
    provider.create.mockResolvedValue(
      (async function* () {
        yield* events
      })()
    )

    const stream = await (gemini as any).interactions.create({
      model: 'gemini-3.8-flash',
      input: 'secret prompt',
      stream: true,
      posthogPrivacyMode: true,
    })
    const received = []
    for await (const event of stream) received.push(event)

    expect(received).toEqual(events)
    const properties = captured(posthog).properties
    expect(properties.$ai_input).toBeNull()
    expect(properties.$ai_output_choices).toBeNull()
    expect(JSON.stringify(properties)).not.toContain('secret prompt')
    expect(JSON.stringify(properties)).not.toContain('"secret":"private"')
    expect(properties.$ai_input_tokens).toBe(7)
  })

  test('captures thrown provider errors once and rethrows the same error', async () => {
    const { posthog, gemini } = setup()
    const error = Object.assign(new Error('provider failed'), { status: 429 })
    provider.create.mockRejectedValue(error)

    await expect((gemini as any).interactions.create({ model: 'gemini-3.8-flash', input: 'Hello' })).rejects.toBe(error)

    const properties = captured(posthog).properties
    expect(properties.$ai_is_error).toBe(true)
    expect(properties.$ai_http_status).toBe(429)
    expect(properties.$ai_input_tokens).toBeUndefined()
  })

  test('captures an in-band stream error once without misreporting it as a success', async () => {
    const { posthog, gemini } = setup()
    const events = [
      {
        event_type: 'interaction.created',
        interaction: { id: 'v1_error', model: 'gemini-3.8-flash', status: 'in_progress' },
      },
      { event_type: 'error', error: { code: 'gateway_timeout', message: 'Deadline expired' } },
    ]
    provider.create.mockResolvedValue(
      (async function* () {
        yield* events
      })()
    )

    const stream = await (gemini as any).interactions.create({
      model: 'gemini-3.8-flash',
      input: 'Hello',
      stream: true,
    })
    const received = []
    for await (const event of stream) received.push(event)

    expect(received).toEqual(events)
    const properties = captured(posthog).properties
    expect(properties.$ai_completion_id).toBe('v1_error')
    expect(properties.$ai_is_error).toBe(true)
    expect(properties.$ai_input_tokens).toBeUndefined()
  })

  test('does not copy sensitive error details into telemetry in privacy mode', async () => {
    const { posthog, gemini } = setup()
    provider.create.mockResolvedValue(
      (async function* () {
        yield {
          event_type: 'interaction.created',
          interaction: { id: 'v1_private_error', model: 'gemini-3.8-flash', status: 'in_progress' },
        }
        yield { event_type: 'error', error: { code: 'invalid_request', message: 'secret prompt was rejected' } }
      })()
    )

    const stream = await (gemini as any).interactions.create({
      model: 'gemini-3.8-flash',
      input: 'secret prompt',
      stream: true,
      posthogPrivacyMode: true,
    })
    for await (const _event of stream) {
      // The caller still receives the unmodified provider events.
    }

    const properties = captured(posthog).properties
    expect(properties.$ai_is_error).toBe(true)
    expect(JSON.stringify(properties)).not.toContain('secret prompt')
  })

  test('captures a provider stream exception once and rethrows the original error', async () => {
    const { posthog, gemini } = setup()
    const error = new Error('stream disconnected')
    provider.create.mockResolvedValue(
      (async function* () {
        yield {
          event_type: 'interaction.created',
          interaction: { id: 'v1_disconnected', model: 'gemini-3.8-flash', status: 'in_progress' },
        }
        throw error
      })()
    )

    const stream = await (gemini as any).interactions.create({
      model: 'gemini-3.8-flash',
      input: 'Hello',
      stream: true,
    })
    const consume = async () => {
      for await (const _event of stream) {
        // Advance to the provider exception.
      }
    }
    await expect(consume()).rejects.toBe(error)

    const properties = captured(posthog).properties
    expect(properties.$ai_completion_id).toBe('v1_disconnected')
    expect(properties.$ai_is_error).toBe(true)
    expect(properties.$ai_input_tokens).toBeUndefined()
  })

  test.each(['failed', 'cancelled'])('does not count a terminal %s status as success', async (status) => {
    const { posthog, gemini } = setup()
    provider.create.mockResolvedValue(
      (async function* () {
        yield {
          event_type: 'interaction.created',
          interaction: { id: 'v1_terminal', model: 'gemini-3.8-flash', status: 'in_progress' },
        }
        yield {
          event_type: 'interaction.completed',
          interaction: {
            id: 'v1_terminal',
            model: 'gemini-3.8-flash',
            status,
            usage: { total_input_tokens: 6, total_output_tokens: 1 },
          },
        }
      })()
    )

    const stream = await (gemini as any).interactions.create({
      model: 'gemini-3.8-flash',
      input: 'Hello',
      stream: true,
    })
    for await (const _event of stream) {
      // Consume the provider stream as an application would.
    }

    const properties = captured(posthog).properties
    expect(properties.$ai_completion_id).toBe('v1_terminal')
    expect(properties.$ai_is_error).toBe(true)
    expect(properties.$ai_stop_reason).toBe(status)
    expect(properties.$ai_input_tokens).toBe(6)
    expect(properties.$ai_output_tokens).toBe(1)
  })

  test('captures once when a caller stops consuming the stream early', async () => {
    const { posthog, gemini } = setup()
    provider.create.mockResolvedValue(
      (async function* () {
        yield {
          event_type: 'interaction.created',
          interaction: { id: 'v1_cancel', model: 'gemini-3.8-flash', status: 'in_progress' },
        }
        yield { event_type: 'step.start', index: 0, step: { type: 'model_output' } }
        yield { event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'partial' } }
        yield { event_type: 'interaction.completed', interaction: { ...textInteraction, id: 'v1_cancel' } }
      })()
    )

    const stream = await (gemini as any).interactions.create({
      model: 'gemini-3.8-flash',
      input: 'Hello',
      stream: true,
    })
    for await (const event of stream) {
      if (event.event_type === 'step.delta') break
    }

    const properties = captured(posthog).properties
    expect(properties.$ai_completion_id).toBe('v1_cancel')
    expect(properties.$ai_output_choices).toEqual([{ role: 'assistant', content: [{ type: 'text', text: 'partial' }] }])
    expect(properties.$ai_input_tokens).toBeUndefined()
    expect(properties.$ai_output_tokens).toBeUndefined()
  })

  test('rejects the experimental SDK 1.x unary response instead of capturing empty output', async () => {
    const { posthog, gemini } = setup()
    provider.create.mockResolvedValue({ id: 'old_interaction', outputs: [{ text: 'Old shape' }] })

    await expect(gemini.interactions.create({ model: 'gemini-2.5-flash', input: 'Hello' })).rejects.toThrow(
      /@google\/genai 2\.18\.0 or newer/
    )

    expect(captured(posthog).properties.$ai_is_error).toBe(true)
  })

  test('rejects the experimental SDK 1.x stream event names', async () => {
    const { posthog, gemini } = setup()
    provider.create.mockResolvedValue(
      (async function* () {
        yield { event_type: 'interaction.start', interaction: { id: 'old_interaction' } }
        yield { event_type: 'content.delta', delta: { text: 'Old shape' } }
      })()
    )

    const stream = await gemini.interactions.create({ model: 'gemini-2.5-flash', input: 'Hello', stream: true })
    await expect(async () => {
      for await (const _event of stream) {
        // Advance to the unsupported event.
      }
    }).rejects.toThrow(/@google\/genai 2\.18\.0 or newer/)

    expect(captured(posthog).properties.$ai_is_error).toBe(true)
  })

  test('keeps the legacy models path working alongside interactions', async () => {
    const { posthog, gemini } = setup()
    provider.generateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: 'Legacy works' }] } }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 },
    })

    await gemini.models.generateContent({ model: 'gemini-2.5-flash', contents: 'Hello' })

    expect(provider.generateContent).toHaveBeenCalledOnce()
    expect(captured(posthog).properties.$ai_output_choices).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'Legacy works' }] },
    ])
  })
})
