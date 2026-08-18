import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
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

const modelRequest = (state: Record<string, unknown>) => ({
  model,
  messages: [new HumanMessage('Hello')],
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
    expect((mockPostHogClient.capture as jest.Mock).mock.calls.map(([event]) => event.event)).toEqual([
      '$ai_generation',
    ])
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
    expect(generations.every(({ properties }) => properties.$ai_parent_id === 'shared-trace')).toBe(true)
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
    })
  })
})
