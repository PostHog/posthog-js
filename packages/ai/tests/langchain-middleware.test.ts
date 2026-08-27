import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
import type { PostHog } from 'posthog-node'
import { createAgent, FakeToolCallingModel, tool } from 'langchain'
import { z } from 'zod'
import { LangChainCallbackHandler } from '../src/langchain/callbacks'
import { createPostHogMiddleware } from '../src/langchain/middleware'

const mockPostHogClient = {
  capture: jest.fn(),
} as unknown as PostHog

const model = {
  toJSON: () => ({ id: ['langchain', 'chat_models', 'FakeChatModel'], kwargs: {} }),
  getLsParams: () => ({ ls_model_name: 'test-model', ls_provider: 'test-provider' }),
}

const runtime = {}

class MetadataModel extends FakeToolCallingModel {
  override getLsParams(options: Parameters<FakeToolCallingModel['getLsParams']>[0]) {
    return {
      ...super.getLsParams(options),
      ls_model_name: 'test-model',
      ls_provider: 'test-provider',
    }
  }

  override invocationParams(options?: Parameters<FakeToolCallingModel['invocationParams']>[0]) {
    return {
      ...super.invocationParams(options),
      model: 'test-model',
      temperature: 0.25,
    }
  }
}

const modelRequest = (state: Record<string, unknown>) => ({
  model,
  messages: [new HumanMessage('Hello')],
  systemMessage: new SystemMessage(''),
  tools: [],
  state,
  runtime,
})

const toolRequest = (state: Record<string, unknown>) => ({
  toolCall: { id: 'tool-call-id', name: 'weather', args: { city: 'London' }, type: 'tool_call' as const },
  tool: { name: 'weather' },
  state,
  runtime,
})

describe('createPostHogMiddleware', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('captures an agent trace with model and tool children', async () => {
    const middleware = createPostHogMiddleware({
      client: mockPostHogClient,
      distinctId: 'user-id',
      properties: { environment: 'test' },
    }) as any
    const initialState = { messages: [new HumanMessage('Hello')] }
    const privateState = middleware.beforeAgent(initialState, runtime)
    const state = { ...initialState, ...privateState }
    const modelResponse = new AIMessage({
      content: 'Checking the weather',
      usage_metadata: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
      response_metadata: { finish_reason: 'tool_calls' },
    })
    const toolResponse = new ToolMessage({
      content: 'Sunny',
      tool_call_id: 'tool-call-id',
      name: 'weather',
    })

    await expect(middleware.wrapModelCall(modelRequest(state), () => Promise.resolve(modelResponse))).resolves.toBe(
      modelResponse
    )
    await expect(middleware.wrapToolCall(toolRequest(state), () => Promise.resolve(toolResponse))).resolves.toBe(
      toolResponse
    )
    middleware.afterAgent({ ...state, messages: [...state.messages, modelResponse, toolResponse] }, runtime)

    const events = (mockPostHogClient.capture as jest.Mock).mock.calls.map(([event]) => event)
    expect(events.map(({ event }) => event)).toEqual(['$ai_generation', '$ai_span', '$ai_trace'])

    const [generation, toolSpan, trace] = events
    expect(generation.properties).toMatchObject({
      $ai_trace_id: trace.properties.$ai_trace_id,
      $ai_parent_id: trace.properties.$ai_span_id,
      $ai_model: 'test-model',
      $ai_provider: 'test-provider',
      $ai_input_tokens: 10,
      $ai_output_tokens: 4,
      environment: 'test',
    })
    expect(toolSpan.properties).toMatchObject({
      $ai_trace_id: trace.properties.$ai_trace_id,
      $ai_parent_id: trace.properties.$ai_span_id,
      $ai_span_name: 'weather',
      environment: 'test',
    })
    expect(trace.distinctId).toBe('user-id')
    expect(trace.properties.$ai_output_state).not.toHaveProperty('_posthogRunId')
  })

  it('instruments a LangChain v1 agent without exposing private state', async () => {
    const weather = tool(async ({ city }) => `Sunny in ${city}`, {
      name: 'weather',
      description: 'Get the weather for a city',
      schema: z.object({ city: z.string() }),
    })
    const agent = createAgent({
      model: new FakeToolCallingModel({
        toolCalls: [[{ id: 'weather-call', name: 'weather', args: { city: 'London' } }], []],
      }),
      tools: [weather],
      middleware: [createPostHogMiddleware({ client: mockPostHogClient })],
    })

    const result = await agent.invoke({ messages: [new HumanMessage('Hello')] })

    expect(result).not.toHaveProperty('_posthogRunId')
    expect((mockPostHogClient.capture as jest.Mock).mock.calls.map(([event]) => event.event)).toEqual([
      '$ai_generation',
      '$ai_span',
      '$ai_generation',
      '$ai_trace',
    ])
  })

  it('preserves custom agent state in trace input and output', async () => {
    const stateSchema = z.object({
      tenantId: z.string(),
      workflow: z.string(),
    })
    const agent = createAgent({
      model: new MetadataModel(),
      tools: [],
      stateSchema,
      middleware: [createPostHogMiddleware({ client: mockPostHogClient, stateSchema })],
    })

    await agent.invoke({
      messages: [new HumanMessage('Hello')],
      tenantId: 'tenant-123',
      workflow: 'support',
    })

    const trace = (mockPostHogClient.capture as jest.Mock).mock.calls
      .map(([event]) => event)
      .find(({ event }) => event === '$ai_trace')
    expect(trace.properties).toMatchObject({
      $ai_input_state: { tenantId: 'tenant-123', workflow: 'support' },
      $ai_output_state: { tenantId: 'tenant-123', workflow: 'support' },
    })
  })

  it('captures model metadata and invocation parameters from a real agent request', async () => {
    const agent = createAgent({
      model: new MetadataModel(),
      tools: [],
      middleware: [createPostHogMiddleware({ client: mockPostHogClient })],
    })

    await agent.invoke({ messages: [new HumanMessage('Hello')] })

    const generation = (mockPostHogClient.capture as jest.Mock).mock.calls[0][0]
    expect(generation.properties).toMatchObject({
      $ai_model: 'test-model',
      $ai_provider: 'test-provider',
      $ai_model_parameters: { temperature: 0.25 },
    })
  })

  it('captures real tool definitions instead of LangChain serialization placeholders', async () => {
    const weather = tool(async ({ city }) => `Sunny in ${city}`, {
      name: 'weather',
      description: 'Get the weather for a city',
      schema: z.object({ city: z.string() }),
    })
    const agent = createAgent({
      model: new MetadataModel({
        toolCalls: [[{ id: 'weather-call', name: 'weather', args: { city: 'London' } }], []],
      }),
      tools: [weather],
      middleware: [createPostHogMiddleware({ client: mockPostHogClient })],
    })

    await agent.invoke({ messages: [new HumanMessage('Hello')] })

    const generation = (mockPostHogClient.capture as jest.Mock).mock.calls[0][0]
    expect(generation.properties.$ai_tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'weather',
          description: 'Get the weather for a city',
          parameters: expect.objectContaining({
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          }),
        },
      },
    ])
  })

  it('captures only the messages that LangChain sends to the model', async () => {
    const agent = createAgent({
      model: new MetadataModel(),
      tools: [],
      middleware: [createPostHogMiddleware({ client: mockPostHogClient })],
    })

    await agent.invoke({ messages: [new HumanMessage('Hello')] })

    const generation = (mockPostHogClient.capture as jest.Mock).mock.calls[0][0]
    expect(generation.properties.$ai_input).toEqual([{ role: 'user', content: 'Hello' }])
  })

  it('keeps a non-empty system message in captured model input', async () => {
    const agent = createAgent({
      model: new MetadataModel(),
      tools: [],
      systemPrompt: 'Be concise',
      middleware: [createPostHogMiddleware({ client: mockPostHogClient })],
    })

    await agent.invoke({ messages: [new HumanMessage('Hello')] })

    const generation = (mockPostHogClient.capture as jest.Mock).mock.calls[0][0]
    expect(generation.properties.$ai_input).toEqual([
      { role: 'system', content: [{ type: 'text', text: 'Be concise' }] },
      { role: 'user', content: 'Hello' },
    ])
  })

  it('does not retain an unfinished root run when an agent fails', async () => {
    const error = new Error('model failed')
    class FailingModel extends FakeToolCallingModel {
      bindTools(): this {
        return this
      }

      async _generate(): Promise<never> {
        throw error
      }
    }

    const chainStart = jest.spyOn(LangChainCallbackHandler.prototype, 'handleChainStart')
    const agent = createAgent({
      model: new FailingModel(),
      tools: [],
      middleware: [createPostHogMiddleware({ client: mockPostHogClient })],
    })

    await expect(agent.invoke({ messages: [new HumanMessage('Hello')] })).rejects.toThrow('model failed')

    expect(chainStart).not.toHaveBeenCalled()
    const events = (mockPostHogClient.capture as jest.Mock).mock.calls.map(([event]) => event)
    expect(events.map(({ event }) => event)).toEqual(['$ai_generation'])
    expect(events[0].properties).not.toHaveProperty('$ai_parent_id')
  })

  it('uses the agent start time when capturing root latency', () => {
    const middleware = createPostHogMiddleware({ client: mockPostHogClient }) as any
    const state = middleware.beforeAgent({ messages: [] }, runtime)
    state._posthogStartTime = 1_000
    jest.spyOn(Date, 'now').mockReturnValue(4_000)

    middleware.afterAgent(state, runtime)

    const trace = (mockPostHogClient.capture as jest.Mock).mock.calls[0][0]
    expect(trace.properties.$ai_latency).toBe(3)
  })

  it('returns and throws the exact values produced by handlers', async () => {
    const middleware = createPostHogMiddleware({ client: mockPostHogClient }) as any
    const privateState = middleware.beforeAgent({ messages: [] }, runtime)
    const response = new AIMessage('Hello')
    const modelError = new Error('model failed')
    const error = new Error('tool failed')

    await expect(middleware.wrapModelCall(modelRequest(privateState), () => Promise.resolve(response))).resolves.toBe(
      response
    )
    await expect(middleware.wrapModelCall(modelRequest(privateState), () => Promise.reject(modelError))).rejects.toBe(
      modelError
    )
    await expect(middleware.wrapToolCall(toolRequest(privateState), () => Promise.reject(error))).rejects.toBe(error)

    const toolEvent = (mockPostHogClient.capture as jest.Mock).mock.calls
      .map(([event]) => event)
      .find(({ event }) => event === '$ai_span')
    expect(toolEvent.properties).toMatchObject({
      $ai_is_error: true,
      $ai_error: expect.stringContaining('tool failed'),
    })
    expect(toolEvent.properties).not.toHaveProperty('$ai_parent_id')
  })

  it('links a recovered model call to the root after a parentless failed attempt', async () => {
    const middleware = createPostHogMiddleware({ client: mockPostHogClient }) as any
    const state = middleware.beforeAgent({ messages: [] }, runtime)

    await expect(
      middleware.wrapModelCall(modelRequest(state), () => Promise.reject(new Error('retryable failure')))
    ).rejects.toThrow('retryable failure')
    await middleware.wrapModelCall(modelRequest(state), () => Promise.resolve(new AIMessage('Recovered')))
    middleware.afterAgent(state, runtime)

    const events = (mockPostHogClient.capture as jest.Mock).mock.calls.map(([event]) => event)
    const [failedGeneration, successfulGeneration, trace] = events
    expect(failedGeneration.properties).not.toHaveProperty('$ai_parent_id')
    expect(successfulGeneration.properties.$ai_parent_id).toBe(trace.properties.$ai_span_id)
    expect(events.every(({ properties }) => properties.$ai_trace_id === trace.properties.$ai_trace_id)).toBe(true)
  })

  it('keeps concurrent agent invocations on separate traces', async () => {
    const middleware = createPostHogMiddleware({ client: mockPostHogClient }) as any
    const stateA = { messages: [new HumanMessage('A')], ...middleware.beforeAgent({ messages: [] }, runtime) }
    const stateB = { messages: [new HumanMessage('B')], ...middleware.beforeAgent({ messages: [] }, runtime) }

    await Promise.all([
      middleware.wrapModelCall(modelRequest(stateA), () => Promise.resolve(new AIMessage('A response'))),
      middleware.wrapModelCall(modelRequest(stateB), () => Promise.resolve(new AIMessage('B response'))),
    ])
    middleware.afterAgent(stateB, runtime)
    middleware.afterAgent(stateA, runtime)

    const events = (mockPostHogClient.capture as jest.Mock).mock.calls.map(([event]) => event)
    const traceIds = events
      .filter(({ event }) => event === '$ai_trace')
      .map(({ properties }) => properties.$ai_trace_id)
    const generationTraceIds = events
      .filter(({ event }) => event === '$ai_generation')
      .map(({ properties }) => properties.$ai_trace_id)

    expect(new Set(traceIds).size).toBe(2)
    expect(new Set(generationTraceIds)).toEqual(new Set(traceIds))
  })

  it('keeps unique run IDs when concurrent agents share an explicit trace ID', async () => {
    const middleware = createPostHogMiddleware({ client: mockPostHogClient, traceId: 'shared-trace' }) as any
    const stateA = middleware.beforeAgent({ messages: [] }, runtime)
    const stateB = middleware.beforeAgent({ messages: [] }, runtime)

    await Promise.all([
      middleware.wrapModelCall(modelRequest(stateA), () => Promise.resolve(new AIMessage('A response'))),
      middleware.wrapModelCall(modelRequest(stateB), () => Promise.resolve(new AIMessage('B response'))),
    ])
    middleware.afterAgent(stateA, runtime)
    middleware.afterAgent(stateB, runtime)

    const events = (mockPostHogClient.capture as jest.Mock).mock.calls.map(([event]) => event)
    const traces = events.filter(({ event }) => event === '$ai_trace')
    const generations = events.filter(({ event }) => event === '$ai_generation')
    expect(traces).toHaveLength(2)
    expect(new Set(traces.map(({ properties }) => properties.$ai_span_id)).size).toBe(2)
    expect(events.every(({ properties }) => properties.$ai_trace_id === 'shared-trace')).toBe(true)
    expect(new Set(generations.map(({ properties }) => properties.$ai_parent_id))).toEqual(
      new Set(traces.map(({ properties }) => properties.$ai_span_id))
    )
  })

  it('applies privacy mode to agent and model content', async () => {
    const middleware = createPostHogMiddleware({ client: mockPostHogClient, privacyMode: true }) as any
    const initialState = { messages: [new HumanMessage('private input')] }
    const state = { ...initialState, ...middleware.beforeAgent(initialState, runtime) }

    await middleware.wrapModelCall(modelRequest(state), () => Promise.resolve(new AIMessage('private output')))
    middleware.afterAgent(state, runtime)

    const [generation, trace] = (mockPostHogClient.capture as jest.Mock).mock.calls.map(([event]) => event)
    expect(generation.properties).toMatchObject({ $ai_input: null, $ai_output_choices: null })
    expect(trace.properties).toMatchObject({ $ai_input_state: null, $ai_output_state: null })
  })

  it('marks returned tool error messages as failed without changing them', async () => {
    const middleware = createPostHogMiddleware({ client: mockPostHogClient }) as any
    const state = middleware.beforeAgent({ messages: [] }, runtime)
    const response = new ToolMessage({
      content: 'Invalid arguments',
      tool_call_id: 'tool-call-id',
      name: 'weather',
      status: 'error',
    })

    await expect(middleware.wrapToolCall(toolRequest(state), () => Promise.resolve(response))).resolves.toBe(response)

    const event = (mockPostHogClient.capture as jest.Mock).mock.calls[0][0]
    expect(event.properties).toMatchObject({
      $ai_is_error: true,
      $ai_error: expect.stringContaining('Invalid arguments'),
      $ai_parent_id: state._posthogRunId,
    })
  })
})
