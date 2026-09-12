// The real @anthropic-ai/claude-agent-sdk spawns the Claude Code CLI, so stub
// the `query()` entry point with a scripted message stream. This mirrors how
// adk.test.ts stubs @google/adk and keeps the test on the capture behavior.
const queryMock = vi.fn()

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (params: any) => queryMock(params),
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY: '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__',
}))

import { instrument, PostHogClaudeAgentProcessor, query } from '../src/claude-agent-sdk'

function createMockClient() {
  return {
    capture: vi.fn(),
    captureImmediate: vi.fn().mockResolvedValue(undefined),
    captureException: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  } as any
}

/** Build a Query-shaped async generator over a scripted message list. */
function scriptedQuery(messages: any[], options: { control?: Record<string, any>; failure?: unknown } = {}): any {
  const generator = (async function* () {
    for (const message of messages) {
      yield message
    }
    if (options.failure) {
      throw options.failure
    }
  })()
  return Object.assign(generator, options.control ?? {})
}

function messageStart(overrides: Record<string, any> = {}): any {
  return {
    type: 'stream_event',
    session_id: 'sess_123',
    event: {
      type: 'message_start',
      message: {
        model: 'claude-sonnet-4-5',
        usage: {
          input_tokens: 100,
          output_tokens: 1,
          cache_read_input_tokens: 20,
          cache_creation_input_tokens: 5,
          ...overrides,
        },
      },
    },
  }
}

function messageDelta(overrides: Record<string, any> = {}): any {
  return {
    type: 'stream_event',
    session_id: 'sess_123',
    event: {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use' },
      usage: { output_tokens: 42 },
      ...overrides,
    },
  }
}

function messageStop(): any {
  return { type: 'stream_event', session_id: 'sess_123', event: { type: 'message_stop' } }
}

function assistantMessage(content: any[]): any {
  return {
    type: 'assistant',
    session_id: 'sess_123',
    message: { model: 'claude-sonnet-4-5', content },
  }
}

function toolResultMessage(content: string | any[]): any {
  return { type: 'user', session_id: 'sess_123', message: { role: 'user', content } }
}

function resultMessage(overrides: Record<string, any> = {}): any {
  return {
    type: 'result',
    subtype: 'success',
    session_id: 'sess_123',
    duration_ms: 4000,
    duration_api_ms: 2500,
    is_error: false,
    num_turns: 1,
    result: 'Done',
    stop_reason: 'end_turn',
    total_cost_usd: 0.0123,
    usage: { input_tokens: 100, output_tokens: 42 },
    ...overrides,
  }
}

function capturedEvents(client: any, event: string): any[] {
  return client.capture.mock.calls.map((call: any[]) => call[0]).filter((message: any) => message.event === event)
}

async function drain(iterable: AsyncIterable<any>): Promise<any[]> {
  const messages: any[] = []
  for await (const message of iterable) {
    messages.push(message)
  }
  return messages
}

describe('Claude Agent SDK integration', () => {
  beforeEach(() => {
    queryMock.mockReset()
  })

  it('captures a generation, a tool span, and a trace for one turn', async () => {
    const client = createMockClient()
    queryMock.mockReturnValue(
      scriptedQuery([
        messageStart(),
        assistantMessage([
          { type: 'text', text: 'Reading the file' },
          { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/tmp/a.ts' } },
        ]),
        toolResultMessage([{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'file body' }]),
        messageDelta(),
        messageStop(),
        resultMessage(),
      ])
    )

    const processor = new PostHogClaudeAgentProcessor({ client, distinctId: 'user_123' })
    await drain(processor.query({ prompt: 'Explain this repo' }))

    const generations = capturedEvents(client, '$ai_generation')
    expect(generations).toHaveLength(1)
    const generation = generations[0].properties
    expect(generations[0].distinctId).toBe('user_123')
    expect(generation.$ai_provider).toBe('anthropic')
    expect(generation.$ai_framework).toBe('claude-agent-sdk')
    expect(generation.$ai_model).toBe('claude-sonnet-4-5')
    expect(generation.$ai_span_name).toBe('generation_1')
    expect(generation.$ai_session_id).toBe('sess_123')
    expect(generation.$ai_input_tokens).toBe(100)
    expect(generation.$ai_output_tokens).toBe(42)
    expect(generation.$ai_cache_read_input_tokens).toBe(20)
    expect(generation.$ai_cache_creation_input_tokens).toBe(5)
    expect(generation.$ai_stop_reason).toBe('tool_use')
    expect(generation.$ai_input).toEqual([{ role: 'user', content: 'Explain this repo' }])
    expect(generation.$ai_output_choices).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Reading the file' },
          { type: 'function', id: 'toolu_1', function: { name: 'Read', arguments: { file_path: '/tmp/a.ts' } } },
        ],
      },
    ])

    const spans = capturedEvents(client, '$ai_span')
    expect(spans).toHaveLength(1)
    expect(spans[0].properties.$ai_span_name).toBe('Read')
    expect(spans[0].properties.$ai_span_type).toBe('tool')
    expect(spans[0].properties.$ai_input_state).toEqual({ file_path: '/tmp/a.ts' })
    // The tool call is parented to the generation that asked for it.
    expect(spans[0].properties.$ai_parent_id).toBe(generation.$ai_span_id)
    expect(spans[0].properties.$ai_trace_id).toBe(generation.$ai_trace_id)

    const traces = capturedEvents(client, '$ai_trace')
    expect(traces).toHaveLength(1)
    expect(traces[0].properties.$ai_trace_name).toBe('claude_agent_sdk_query')
    expect(traces[0].properties.$ai_trace_id).toBe(generation.$ai_trace_id)
    expect(traces[0].properties.$ai_latency).toBe(4)
    expect(traces[0].properties.$ai_total_cost_usd).toBe(0.0123)
    expect(traces[0].properties.$ai_is_error).toBeUndefined()
  })

  it('yields every message unchanged and hides the stream events the caller did not request', async () => {
    const client = createMockClient()
    const messages = [messageStart(), assistantMessage([{ type: 'text', text: 'Hi' }]), messageStop(), resultMessage()]
    queryMock.mockReturnValue(scriptedQuery(messages))

    const yielded = await drain(instrument({ client }).query({ prompt: 'Hello' }))

    expect(yielded).toEqual([messages[1], messages[3]])
    expect(queryMock).toHaveBeenCalledWith({
      prompt: 'Hello',
      options: { includePartialMessages: true },
    })
  })

  it('forwards stream events when the caller asked for partial messages', async () => {
    const client = createMockClient()
    const messages = [messageStart(), messageStop(), resultMessage()]
    queryMock.mockReturnValue(scriptedQuery(messages))

    const yielded = await drain(
      instrument({ client }).query({ prompt: 'Hello', options: { includePartialMessages: true } })
    )

    expect(yielded).toEqual(messages)
  })

  it.each([true, false])('promotes every tool result to the next generation (is_error=%s)', async (is_error) => {
    const client = createMockClient()
    queryMock.mockReturnValue(
      scriptedQuery([
        messageStart(),
        assistantMessage([{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }]),
        toolResultMessage([{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'a.ts' }]),
        toolResultMessage([{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'b.ts', is_error }]),
        messageStop(),
        messageStart(),
        assistantMessage([{ type: 'text', text: 'One file' }]),
        messageStop(),
        resultMessage({ num_turns: 2 }),
      ])
    )

    await drain(instrument({ client, distinctId: 'user_123' }).query({ prompt: 'List the files' }))

    const generations = capturedEvents(client, '$ai_generation')
    expect(generations).toHaveLength(2)
    expect(generations[0].properties.$ai_span_name).toBe('generation_1')
    expect(generations[0].properties.$ai_input).toEqual([{ role: 'user', content: 'List the files' }])
    expect(generations[1].properties.$ai_span_name).toBe('generation_2')
    expect(generations[1].properties.$ai_input).toEqual([
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'a.ts' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'b.ts', is_error }] },
    ])
  })

  it('promotes tool results that arrive after the turn closed', async () => {
    // The CLI can deliver the tool result either side of `message_stop`, so
    // both orderings must reach the next generation.
    const client = createMockClient()
    queryMock.mockReturnValue(
      scriptedQuery([
        messageStart(),
        assistantMessage([{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }]),
        messageStop(),
        toolResultMessage([{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'a.ts' }]),
        messageStart(),
        assistantMessage([{ type: 'text', text: 'One file' }]),
        messageStop(),
        resultMessage({ num_turns: 2 }),
      ])
    )

    await drain(instrument({ client }).query({ prompt: 'List the files' }))

    const generations = capturedEvents(client, '$ai_generation')
    expect(generations).toHaveLength(2)
    expect(generations[0].properties.$ai_input).toEqual([{ role: 'user', content: 'List the files' }])
    expect(generations[1].properties.$ai_input).toEqual([
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'a.ts' }] },
    ])
  })

  it('joins the assistant messages of one model call into a single output', async () => {
    const client = createMockClient()
    queryMock.mockReturnValue(
      scriptedQuery([
        messageStart(),
        assistantMessage([{ type: 'text', text: 'Let me look' }]),
        assistantMessage([{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }]),
        messageStop(),
        resultMessage(),
      ])
    )

    await drain(instrument({ client }).query({ prompt: 'Hello' }))

    expect(capturedEvents(client, '$ai_generation')[0].properties.$ai_output_choices).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me look' },
          { type: 'function', id: 'toolu_1', function: { name: 'Read', arguments: {} } },
        ],
      },
    ])
  })

  it.each([
    'You are terse',
    ['You are ', '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__', 'terse'],
    { type: 'preset', preset: 'claude_code', append: 'You are terse' },
  ])('records the supplied system prompt text as the first input message (%j)', async (systemPrompt) => {
    const client = createMockClient()
    queryMock.mockReturnValue(scriptedQuery([messageStart(), messageStop(), resultMessage()]))

    await drain(instrument({ client }).query({ prompt: 'Hello', options: { systemPrompt } as any }))

    expect(capturedEvents(client, '$ai_generation')[0].properties.$ai_input).toEqual([
      { role: 'system', content: 'You are terse' },
      { role: 'user', content: 'Hello' },
    ])
  })

  it('records thinking blocks as reasoning content', async () => {
    const client = createMockClient()
    queryMock.mockReturnValue(
      scriptedQuery([
        messageStart(),
        assistantMessage([
          { type: 'thinking', thinking: 'Let me check', signature: 'sig' },
          { type: 'text', text: 'Checked' },
        ]),
        messageStop(),
        resultMessage(),
      ])
    )

    await drain(instrument({ client }).query({ prompt: 'Think' }))

    expect(capturedEvents(client, '$ai_generation')[0].properties.$ai_output_choices).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'Let me check' },
          { type: 'text', text: 'Checked' },
        ],
      },
    ])
  })

  it('falls back to the result aggregate when no stream events arrive', async () => {
    const client = createMockClient()
    queryMock.mockReturnValue(
      scriptedQuery([assistantMessage([{ type: 'text', text: 'Done' }]), resultMessage({ is_error: true })])
    )

    await drain(instrument({ client }).query({ prompt: 'Hello' }))

    const generations = capturedEvents(client, '$ai_generation')
    expect(generations).toHaveLength(1)
    expect(generations[0].properties.$ai_model).toBe('claude-sonnet-4-5')
    expect(generations[0].properties.$ai_input_tokens).toBe(100)
    expect(generations[0].properties.$ai_output_tokens).toBe(42)
    expect(generations[0].properties.$ai_latency).toBe(2.5)
    expect(generations[0].properties.$ai_total_cost_usd).toBe(0.0123)
    expect(generations[0].properties.$ai_is_error).toBe(true)
    expect(capturedEvents(client, '$ai_trace')[0].properties.$ai_is_error).toBe(true)
  })

  it('gives each turn of a streaming-input session its own trace, unless a trace ID is pinned', async () => {
    const client = createMockClient()
    const turns = [messageStart(), messageStop(), resultMessage(), messageStart(), messageStop(), resultMessage()]

    queryMock.mockReturnValue(scriptedQuery(turns))
    await drain(instrument({ client }).query({ prompt: 'Hello' }))
    const traceIds = capturedEvents(client, '$ai_trace').map((event) => event.properties.$ai_trace_id)
    expect(traceIds).toHaveLength(2)
    expect(traceIds[0]).not.toBe(traceIds[1])

    const pinnedClient = createMockClient()
    queryMock.mockReturnValue(scriptedQuery(turns))
    await drain(instrument({ client: pinnedClient, traceId: 'trace_pinned' }).query({ prompt: 'Hello' }))
    expect(capturedEvents(pinnedClient, '$ai_trace').map((event) => event.properties.$ai_trace_id)).toEqual([
      'trace_pinned',
      'trace_pinned',
    ])
  })

  it('closes the trace when the query fails, and rethrows the failure', async () => {
    const client = createMockClient()
    const failure = new Error('CLI exited')
    queryMock.mockReturnValue(scriptedQuery([messageStart(), messageStop()], { failure }))

    await expect(drain(instrument({ client }).query({ prompt: 'Hello' }))).rejects.toThrow('CLI exited')

    const traces = capturedEvents(client, '$ai_trace')
    expect(traces).toHaveLength(1)
    expect(traces[0].properties.$ai_is_error).toBe(true)
    expect(traces[0].properties.$ai_error).toContain('CLI exited')
    expect(capturedEvents(client, '$ai_generation')).toHaveLength(1)
  })

  it.each(['break', 'failure', 'return', 'throw', 'close', 'dispose'])(
    'finalizes an unfinished generation on %s',
    async (ending) => {
      const client = createMockClient()
      const failure = new Error('CLI exited')
      const messages = [messageStart(), assistantMessage([{ type: 'text', text: 'Partial answer' }])]
      const stream = scriptedQuery(messages, { failure: ending === 'failure' ? failure : undefined })
      const close = vi.fn()
      const dispose = vi.fn().mockResolvedValue(undefined)
      queryMock.mockReturnValue(Object.assign(stream, { close, [Symbol.asyncDispose]: dispose }))
      const running = instrument({ client }).query({ prompt: 'Hello' })

      if (ending === 'break') {
        for await (const _message of running) break
      } else if (ending === 'failure') {
        await expect(drain(running)).rejects.toThrow(failure)
      } else {
        await running.next()
        if (ending === 'return') await running.return()
        if (ending === 'throw') await expect(running.throw(failure)).rejects.toThrow(failure)
        if (ending === 'close') {
          running.close()
          await vi.waitFor(() => expect(capturedEvents(client, '$ai_trace')).toHaveLength(1))
          expect(close).toHaveBeenCalledOnce()
        }
        if (ending === 'dispose') {
          await (running as any)[Symbol.asyncDispose]()
          expect(dispose).toHaveBeenCalledOnce()
        }
      }

      const traces = capturedEvents(client, '$ai_trace')
      expect(traces).toHaveLength(1)
      expect(traces[0].properties.$ai_is_error).toBe(ending === 'failure' || ending === 'throw' ? true : undefined)
      const generations = capturedEvents(client, '$ai_generation')
      expect(generations).toHaveLength(1)
      expect(generations[0].properties.$ai_input_tokens).toBe(100)
      expect(generations[0].properties.$ai_output_choices).toEqual([
        { role: 'assistant', content: [{ type: 'text', text: 'Partial answer' }] },
      ])
    }
  )

  it.each(['return', 'throw'])('calls SDK cleanup on %s before the first next', async (ending) => {
    const client = createMockClient()
    const failure = new Error('Cancelled')
    const cleanup = vi.fn(async () => {
      if (ending === 'throw') throw failure
      return { done: true, value: undefined }
    })
    queryMock.mockReturnValue(scriptedQuery([], { control: { [ending]: cleanup } }))

    const running = instrument({ client }).query({ prompt: 'Hello' })
    if (ending === 'throw') await expect(running.throw(failure)).rejects.toThrow(failure)
    else await running.return()

    expect(cleanup).toHaveBeenCalledOnce()
    expect(client.capture).not.toHaveBeenCalled()
  })

  it('keeps the control methods of the underlying query', async () => {
    const client = createMockClient()
    const interrupt = vi.fn().mockResolvedValue(undefined)
    const received: any[] = []
    const streamInput = vi.fn(async (stream: AsyncIterable<any>) => {
      received.push(...(await drain(stream)))
    })
    queryMock.mockReturnValue(
      scriptedQuery([resultMessage(), resultMessage()], { control: { interrupt, streamInput } })
    )

    const running = instrument({ client }).query({ prompt: 'Hello' })
    await running.interrupt()
    const followup = toolResultMessage('Follow-up')
    await running.streamInput(
      (async function* () {
        yield followup
      })()
    )

    expect(interrupt).toHaveBeenCalled()
    expect(received).toEqual([followup])
    await drain(running)
    expect(capturedEvents(client, '$ai_generation').map((event) => event.properties.$ai_input)).toEqual([
      [{ role: 'user', content: 'Hello' }],
      [{ role: 'user', content: 'Follow-up' }],
    ])
  })

  it('redacts content in privacy mode and captures anonymously without a distinct ID', async () => {
    const client = createMockClient()
    queryMock.mockReturnValue(
      scriptedQuery([
        messageStart(),
        assistantMessage([{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/tmp/a.ts' } }]),
        messageStop(),
        resultMessage(),
      ])
    )

    await drain(instrument({ client, privacyMode: true }).query({ prompt: 'Secret' }))

    const generation = capturedEvents(client, '$ai_generation')[0]
    expect(generation.properties.$ai_input).toBeNull()
    expect(generation.properties.$ai_output_choices).toBeNull()
    expect(generation.properties.$process_person_profile).toBe(false)
    expect(generation.distinctId).toBe(generation.properties.$ai_trace_id)
    expect(capturedEvents(client, '$ai_span')[0].properties.$ai_input_state).toBeNull()
  })

  it('resolves the distinct ID from the result message and merges extra properties and groups', async () => {
    const client = createMockClient()
    queryMock.mockReturnValue(scriptedQuery([messageStart(), messageStop(), resultMessage()]))

    await drain(
      query({
        prompt: 'Hello',
        posthog: {
          client,
          distinctId: (result: any) => result.session_id,
          properties: { environment: 'production' },
          groups: { organization: 'org_1' },
        },
      })
    )

    const trace = capturedEvents(client, '$ai_trace')[0]
    expect(trace.distinctId).toBe('sess_123')
    expect(trace.properties.environment).toBe('production')
    expect(trace.groups).toEqual({ organization: 'org_1' })
    // A resolver needs the result message, so a generation captured before it
    // stays anonymous.
    const generation = capturedEvents(client, '$ai_generation')[0]
    expect(generation.properties.$process_person_profile).toBe(false)
    expect(generation.properties.environment).toBe('production')
  })

  it('truncates long tool results', async () => {
    const client = createMockClient()
    queryMock.mockReturnValue(
      scriptedQuery([
        messageStart(),
        assistantMessage([{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }]),
        toolResultMessage([{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'a file line\n'.repeat(900) }]),
        messageStop(),
        messageStart(),
        messageStop(),
        resultMessage(),
      ])
    )

    await drain(instrument({ client }).query({ prompt: 'Read it' }))

    const input = capturedEvents(client, '$ai_generation')[1].properties.$ai_input
    expect(input[0].content[0].content).toBe(`${'a file line\n'.repeat(900).slice(0, 5000)}... [truncated]`)
  })

  it('reports instrumentation failures through onError without breaking the query', async () => {
    const client = createMockClient()
    client.capture.mockImplementation(() => {
      throw new Error('capture failed')
    })
    const onError = vi.fn()
    queryMock.mockReturnValue(
      scriptedQuery([
        messageStart(),
        assistantMessage([{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }]),
        messageStop(),
        resultMessage(),
      ])
    )

    const yielded = await drain(instrument({ client, onError }).query({ prompt: 'Hello' }))

    expect(yielded).toHaveLength(2)
    expect(onError).toHaveBeenCalled()
  })

  it('awaits delivery when captureImmediate is set', async () => {
    const client = createMockClient()
    queryMock.mockReturnValue(scriptedQuery([messageStart(), messageStop(), resultMessage()]))

    await drain(instrument({ client, captureImmediate: true }).query({ prompt: 'Hello' }))

    expect(client.capture).not.toHaveBeenCalled()
    expect(client.captureImmediate).toHaveBeenCalled()
  })

  it.each([true, false])('records per-turn costs from cumulative totals (streaming=%s)', async (streaming) => {
    const client = createMockClient()
    queryMock.mockReturnValue(
      scriptedQuery(
        [0.1, 0.3, 0.05].flatMap((total_cost_usd) => [
          ...(streaming ? [messageStart(), messageStop()] : []),
          resultMessage({ total_cost_usd }),
        ])
      )
    )

    await drain(instrument({ client }).query({ prompt: 'Hello' }))

    for (const event of streaming ? ['$ai_trace'] : ['$ai_trace', '$ai_generation']) {
      const costs = capturedEvents(client, event).map((capture) => capture.properties.$ai_total_cost_usd)
      expect(costs).toHaveLength(3)
      expect(costs[0]).toBeCloseTo(0.1)
      expect(costs[1]).toBeCloseTo(0.2)
      expect(costs[2]).toBeCloseTo(0.05)
    }
  })

  it.each([false, true])('keeps output within its turn (streamed first turn=%s)', async (streaming) => {
    const client = createMockClient()
    queryMock.mockReturnValue(
      scriptedQuery([
        ...(streaming ? [messageStart(), messageStop()] : []),
        assistantMessage([{ type: 'text', text: 'First turn' }]),
        resultMessage(),
        assistantMessage([{ type: 'text', text: 'Second turn' }]),
        resultMessage(),
      ])
    )

    await drain(instrument({ client }).query({ prompt: 'Hello' }))

    const generations = capturedEvents(client, '$ai_generation')
    expect(generations).toHaveLength(2)
    expect(generations[1].properties.$ai_output_choices).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'Second turn' }] },
    ])
    expect(generations[1].properties.$ai_input).toEqual([])
  })

  it('keeps subagent content separate and parents nested tools to the agent tool', async () => {
    const client = createMockClient()
    queryMock.mockReturnValue(
      scriptedQuery([
        messageStart(),
        assistantMessage([{ type: 'tool_use', id: 'agent_1', name: 'Agent', input: {} }]),
        messageStop(),
        {
          ...assistantMessage([{ type: 'tool_use', id: 'nested_1', name: 'Read', input: {} }]),
          parent_tool_use_id: 'agent_1',
        },
        {
          ...toolResultMessage([{ type: 'tool_result', tool_use_id: 'nested_1', content: 'Child data' }]),
          parent_tool_use_id: 'agent_1',
        },
        { ...assistantMessage([{ type: 'text', text: 'Child answer' }]), parent_tool_use_id: 'agent_1' },
        toolResultMessage([{ type: 'tool_result', tool_use_id: 'agent_1', content: 'Summary' }]),
        messageStart(),
        assistantMessage([{ type: 'text', text: 'Main answer' }]),
        messageStop(),
        resultMessage(),
      ])
    )

    await drain(instrument({ client }).query({ prompt: 'Delegate' }))

    expect(capturedEvents(client, '$ai_span')[1].properties.$ai_parent_id).toBe('agent_1')
    const generation = capturedEvents(client, '$ai_generation')[1].properties
    expect(generation.$ai_input).toEqual([
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'agent_1', content: 'Summary' }] },
    ])
    expect(generation.$ai_output_choices).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'Main answer' }] },
    ])
  })

  it.each([false, true])(
    'keeps capture failures from corrupting later events (immediate=%s)',
    async (captureImmediate) => {
      const client = createMockClient()
      const onError = vi.fn()
      const capture = captureImmediate ? client.captureImmediate : client.capture
      let failedTrace = false
      capture.mockImplementation((event: any) => {
        if (event.event === '$ai_span' || (event.event === '$ai_trace' && !failedTrace)) {
          if (event.event === '$ai_trace') failedTrace = true
          if (captureImmediate) return Promise.reject(new Error('capture failed'))
          throw new Error('capture failed')
        }
        return captureImmediate ? Promise.resolve() : undefined
      })
      queryMock.mockReturnValue(
        scriptedQuery(
          [0.1, 0.3].flatMap((total_cost_usd) => [
            messageStart(),
            assistantMessage([
              { type: 'text', text: 'Reading' },
              { type: 'tool_use', id: 'tool_1', name: 'Read', input: {} },
              { type: 'tool_use', id: 'tool_2', name: 'Read', input: {} },
            ]),
            messageStop(),
            resultMessage({ total_cost_usd }),
          ])
        )
      )

      await drain(instrument({ client, captureImmediate, onError }).query({ prompt: 'Hello' }))

      const events = capture.mock.calls.map(([event]: any[]) => event)
      const generations = events.filter((event: any) => event.event === '$ai_generation')
      const traces = events.filter((event: any) => event.event === '$ai_trace')
      expect(traces).toHaveLength(2)
      expect(traces[1].properties.$ai_trace_id).not.toBe(traces[0].properties.$ai_trace_id)
      expect(traces[1].properties.$ai_total_cost_usd).toBeCloseTo(0.2)
      expect(generations.map((event: any) => event.properties.$ai_span_name)).toEqual(['generation_1', 'generation_1'])
      expect(generations[0].properties.$ai_output_choices[0].content).toHaveLength(3)
      expect(events.filter((event: any) => event.event === '$ai_span')).toHaveLength(4)
      expect(onError).toHaveBeenCalledTimes(5)
    }
  )

  it.each([
    { subtype: 'error_during_execution', errors: ['CLI failed', 'Try again'] },
    { subtype: 'success', result: 'The request was rejected' },
  ])('captures error result details (%j)', async (errorResult) => {
    const client = createMockClient()
    queryMock.mockReturnValue(scriptedQuery([resultMessage({ ...errorResult, is_error: true })]))

    await drain(instrument({ client }).query({ prompt: 'Hello' }))

    for (const event of ['$ai_generation', '$ai_trace']) {
      const properties = capturedEvents(client, event)[0].properties
      expect(properties.$ai_is_error).toBe(true)
      expect(properties.$ai_error).toContain(errorResult.errors?.[0] ?? errorResult.result)
    }
  })

  it('includes SDK time to first token in generation latency', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance'] })
    try {
      const client = createMockClient()
      queryMock.mockReturnValue(
        (async function* () {
          yield { ...messageStart(), ttft_ms: 1200 }
          vi.advanceTimersByTime(200)
          vi.setSystemTime(Date.now() - 5000)
          yield messageStop()
          yield resultMessage()
        })()
      )

      await drain(instrument({ client }).query({ prompt: 'Hello' }))

      const generation = capturedEvents(client, '$ai_generation')[0].properties
      expect(generation.$ai_latency).toBeCloseTo(1.4)
      expect(generation.$ai_time_to_first_token).toBe(1.2)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([false, true])(
    'captures queued input per turn and preserves reply correlation (partials=%s)',
    async (includePartialMessages) => {
      const client = createMockClient()
      const prompts = [
        { ...toolResultMessage('Context'), shouldQuery: false },
        { ...toolResultMessage('First prompt'), uuid: 'prompt_1' },
        { ...toolResultMessage('Second prompt'), uuid: 'prompt_2' },
      ]
      const received: any[] = []
      const replies = [
        assistantMessage([{ type: 'text', text: 'First answer' }]),
        assistantMessage([{ type: 'text', text: 'Second answer' }]),
      ]
      queryMock.mockImplementation(({ prompt }) =>
        (async function* () {
          for await (const message of prompt) received.push(message)
          for (const index of [0, 1]) {
            yield { ...prompts[index + 1], isReplay: true }
            yield { ...messageStart(), user_message_uuid: `prompt_${index + 1}` }
            yield replies[index]
            yield messageStop()
            yield resultMessage()
          }
        })()
      )
      const prompt = (async function* () {
        yield* prompts
      })()

      const yielded = await drain(
        instrument({ client }).query({ prompt, options: { includePartialMessages, systemPrompt: 'System' } })
      )

      expect(received).toEqual(prompts)
      received.forEach((message, index) => expect(message).toBe(prompts[index]))
      const generations = capturedEvents(client, '$ai_generation')
      expect(generations[0].properties.$ai_input).toEqual([
        { role: 'system', content: 'System' },
        { role: 'user', content: 'Context' },
        { role: 'user', content: 'First prompt' },
      ])
      expect(generations[1].properties.$ai_input).toEqual([{ role: 'user', content: 'Second prompt' }])
      expect(
        yielded.filter((message) => message.type === 'assistant').map((message) => message.user_message_uuid)
      ).toEqual(includePartialMessages ? [undefined, undefined] : ['prompt_1', 'prompt_2'])
      expect(replies[0].user_message_uuid).toBeUndefined()
    }
  )
})
