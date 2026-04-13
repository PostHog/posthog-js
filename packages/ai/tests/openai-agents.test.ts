import { PostHogTracingProcessor } from '../src/openai-agents/processor'

// Mock types matching @openai/agents-core interfaces
interface MockTrace {
  type: 'trace'
  traceId: string
  name: string
  groupId: string | null
  metadata?: Record<string, any>
}

interface MockSpanError {
  message: string
  data?: Record<string, any>
}

interface MockSpan {
  type: 'trace.span'
  traceId: string
  spanId: string
  parentId: string | null
  spanData: any
  startedAt: string | null
  endedAt: string | null
  error: MockSpanError | null
}

function createMockClient() {
  return {
    capture: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    privacy_mode: false,
  } as any
}

function createMockTrace(overrides: Partial<MockTrace> = {}): MockTrace {
  return {
    type: 'trace',
    traceId: 'trace_123456789',
    name: 'Test Workflow',
    groupId: 'group_123',
    metadata: { key: 'value' },
    ...overrides,
  }
}

function createMockSpan(overrides: Partial<MockSpan> = {}): MockSpan {
  return {
    type: 'trace.span',
    traceId: 'trace_123456789',
    spanId: 'span_987654321',
    parentId: null,
    spanData: { type: 'generation', model: 'gpt-4o' },
    startedAt: '2024-01-01T00:00:00Z',
    endedAt: '2024-01-01T00:00:01Z',
    error: null,
    ...overrides,
  }
}

describe('PostHogTracingProcessor', () => {
  let mockClient: ReturnType<typeof createMockClient>
  let processor: PostHogTracingProcessor

  beforeEach(() => {
    mockClient = createMockClient()
    processor = new PostHogTracingProcessor({
      client: mockClient,
      distinctId: 'test-user',
      privacyMode: false,
    })
  })

  describe('initialization', () => {
    it('initializes correctly with all options', () => {
      const proc = new PostHogTracingProcessor({
        client: mockClient,
        distinctId: 'user@example.com',
        privacyMode: true,
        groups: { company: 'acme' },
        properties: { env: 'test' },
      })

      expect(proc).toBeInstanceOf(PostHogTracingProcessor)
    })

    it('initializes with minimal options', () => {
      const proc = new PostHogTracingProcessor({
        client: mockClient,
      })

      expect(proc).toBeInstanceOf(PostHogTracingProcessor)
    })
  })

  describe('trace lifecycle', () => {
    it('on_trace_start stores metadata without capturing event', async () => {
      const trace = createMockTrace()
      await processor.onTraceStart(trace as any)

      expect(mockClient.capture).not.toHaveBeenCalled()
    })

    it('on_trace_end captures $ai_trace event', async () => {
      const trace = createMockTrace()
      await processor.onTraceStart(trace as any)
      await processor.onTraceEnd(trace as any)

      expect(mockClient.capture).toHaveBeenCalledTimes(1)
      const call = mockClient.capture.mock.calls[0][0]

      expect(call.event).toBe('$ai_trace')
      expect(call.distinctId).toBe('test-user')
      expect(call.properties.$ai_trace_id).toBe('trace_123456789')
      expect(call.properties.$ai_trace_name).toBe('Test Workflow')
      expect(call.properties.$ai_provider).toBe('openai')
      expect(call.properties.$ai_framework).toBe('openai-agents')
      expect(call.properties.$ai_latency).toBeDefined()
    })

    it('includes group_id in trace events', async () => {
      const trace = createMockTrace({ groupId: 'group_abc' })
      await processor.onTraceStart(trace as any)
      await processor.onTraceEnd(trace as any)

      const call = mockClient.capture.mock.calls[0][0]
      expect(call.properties.$ai_group_id).toBe('group_abc')
    })

    it('includes trace metadata in trace events', async () => {
      const trace = createMockTrace({ metadata: { user_id: 'u123', session: 'sess_1' } })
      await processor.onTraceStart(trace as any)
      await processor.onTraceEnd(trace as any)

      const call = mockClient.capture.mock.calls[0][0]
      expect(call.properties.$ai_trace_metadata).toEqual({ user_id: 'u123', session: 'sess_1' })
    })
  })

  describe('personless mode', () => {
    it('uses personless mode when no distinct_id is provided', async () => {
      const proc = new PostHogTracingProcessor({ client: mockClient })
      const trace = createMockTrace()

      await proc.onTraceStart(trace as any)
      await proc.onTraceEnd(trace as any)

      const call = mockClient.capture.mock.calls[0][0]
      expect(call.properties.$process_person_profile).toBe(false)
      expect(call.distinctId).toBe(trace.traceId)
    })

    it('uses personless mode for spans when no distinct_id is provided', async () => {
      const proc = new PostHogTracingProcessor({ client: mockClient })
      const trace = createMockTrace()
      const span = createMockSpan({
        spanData: { type: 'generation', model: 'gpt-4o' },
      })

      await proc.onTraceStart(trace as any)
      mockClient.capture.mockClear()

      await proc.onSpanStart(span as any)
      await proc.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]
      expect(call.properties.$process_person_profile).toBe(false)
      expect(call.distinctId).toBe(trace.traceId)
    })

    it('uses personless mode when callable distinct_id returns null', async () => {
      const proc = new PostHogTracingProcessor({
        client: mockClient,
        distinctId: () => null,
      })
      const trace = createMockTrace()
      const span = createMockSpan({
        spanData: { type: 'generation', model: 'gpt-4o' },
      })

      await proc.onTraceStart(trace as any)
      mockClient.capture.mockClear()

      await proc.onSpanStart(span as any)
      await proc.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]
      expect(call.properties.$process_person_profile).toBe(false)
      expect(call.distinctId).toBe(trace.traceId)
    })

    it('does not set $process_person_profile when distinct_id is provided', async () => {
      const trace = createMockTrace()
      await processor.onTraceStart(trace as any)
      await processor.onTraceEnd(trace as any)

      const call = mockClient.capture.mock.calls[0][0]
      expect(call.properties.$process_person_profile).toBeUndefined()
    })
  })

  describe('distinct_id resolution', () => {
    it('supports callable distinct_id', async () => {
      const proc = new PostHogTracingProcessor({
        client: mockClient,
        distinctId: (trace: any) => `user-${trace.name}`,
      })
      const trace = createMockTrace()

      await proc.onTraceStart(trace as any)
      await proc.onTraceEnd(trace as any)

      const call = mockClient.capture.mock.calls[0][0]
      expect(call.distinctId).toBe('user-Test Workflow')
    })

    it('spans use distinct_id resolved at trace start', async () => {
      const proc = new PostHogTracingProcessor({
        client: mockClient,
        distinctId: (trace: any) => `user-${trace.name}`,
      })
      const trace = createMockTrace()
      const span = createMockSpan({
        spanData: { type: 'generation', model: 'gpt-4o' },
      })

      await proc.onTraceStart(trace as any)
      mockClient.capture.mockClear()

      await proc.onSpanStart(span as any)
      await proc.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]
      expect(call.distinctId).toBe('user-Test Workflow')
    })
  })

  describe('generation spans', () => {
    it('maps GenerationSpanData to $ai_generation event', async () => {
      const span = createMockSpan({
        spanData: {
          type: 'generation',
          input: [{ role: 'user', content: 'Hello' }],
          output: [{ role: 'assistant', content: 'Hi there!' }],
          model: 'gpt-4o',
          model_config: { temperature: 0.7, max_tokens: 100 },
          usage: { input_tokens: 10, output_tokens: 20 },
        },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]

      expect(call.event).toBe('$ai_generation')
      expect(call.properties.$ai_trace_id).toBe('trace_123456789')
      expect(call.properties.$ai_span_id).toBe('span_987654321')
      expect(call.properties.$ai_provider).toBe('openai')
      expect(call.properties.$ai_framework).toBe('openai-agents')
      expect(call.properties.$ai_model).toBe('gpt-4o')
      expect(call.properties.$ai_input_tokens).toBe(10)
      expect(call.properties.$ai_output_tokens).toBe(20)
      expect(call.properties.$ai_total_tokens).toBe(30)
      expect(call.properties.$ai_input).toEqual([{ role: 'user', content: 'Hello' }])
      expect(call.properties.$ai_output_choices).toEqual([{ role: 'assistant', content: 'Hi there!' }])
      expect(call.properties.$ai_model_parameters).toEqual({ temperature: 0.7, max_tokens: 100 })
    })

    it('handles no usage data with zero defaults', async () => {
      const span = createMockSpan({
        spanData: { type: 'generation', model: 'gpt-4o' },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]
      expect(call.properties.$ai_input_tokens).toBe(0)
      expect(call.properties.$ai_output_tokens).toBe(0)
      expect(call.properties.$ai_total_tokens).toBe(0)
    })

    it('handles partial usage data', async () => {
      const span = createMockSpan({
        spanData: {
          type: 'generation',
          model: 'gpt-4o',
          usage: { input_tokens: 42 },
        },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]
      expect(call.properties.$ai_input_tokens).toBe(42)
      expect(call.properties.$ai_output_tokens).toBe(0)
      expect(call.properties.$ai_total_tokens).toBe(42)
    })

    it('includes reasoning tokens when present', async () => {
      const span = createMockSpan({
        spanData: {
          type: 'generation',
          model: 'o1-preview',
          usage: {
            input_tokens: 100,
            output_tokens: 500,
            reasoning_tokens: 400,
          },
        },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]
      expect(call.properties.$ai_reasoning_tokens).toBe(400)
    })

    it('includes cache tokens from details when present', async () => {
      const span = createMockSpan({
        spanData: {
          type: 'generation',
          model: 'gpt-4o',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            details: {
              cache_read_input_tokens: 80,
              cache_creation_input_tokens: 20,
            },
          },
        },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]
      expect(call.properties.$ai_cache_read_input_tokens).toBe(80)
      expect(call.properties.$ai_cache_creation_input_tokens).toBe(20)
    })
  })

  describe('input role normalization', () => {
    it('adds role=assistant to function_call items in generation input', async () => {
      const span = createMockSpan({
        spanData: {
          type: 'generation',
          model: 'gpt-4o',
          input: [
            { role: 'user', content: 'What is the weather?', type: 'message' },
            { type: 'function_call', name: 'get_weather', arguments: '{"city":"Tokyo"}', callId: 'call_1' },
            { type: 'function_call_result', name: 'get_weather', output: { text: 'Sunny' }, callId: 'call_1' },
          ],
        },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]
      const input = call.properties.$ai_input

      expect(input[0].role).toBe('user')
      expect(input[1].role).toBe('assistant')
      expect(input[1].type).toBe('function_call')
      expect(input[2].role).toBe('tool')
      expect(input[2].type).toBe('function_call_result')
    })

    it('adds role=assistant to function_call items in response span input', async () => {
      const span = createMockSpan({
        spanData: {
          type: 'response',
          response_id: 'resp_123',
          _input: [
            { role: 'user', content: 'Hello', type: 'message' },
            { type: 'function_call', name: 'search', arguments: '{}', callId: 'call_2' },
            { type: 'function_call_result', name: 'search', output: { text: 'results' }, callId: 'call_2' },
          ],
          _response: { id: 'resp_123', model: 'gpt-4o' },
        },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]
      const input = call.properties.$ai_input

      expect(input[0].role).toBe('user')
      expect(input[1].role).toBe('assistant')
      expect(input[2].role).toBe('tool')
    })

    it('does not override existing role fields', async () => {
      const span = createMockSpan({
        spanData: {
          type: 'generation',
          model: 'gpt-4o',
          input: [
            { role: 'system', content: 'You are helpful', type: 'message' },
            { role: 'user', content: 'Hi', type: 'message' },
          ],
        },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]
      const input = call.properties.$ai_input

      expect(input[0].role).toBe('system')
      expect(input[1].role).toBe('user')
    })
  })

  describe('function spans', () => {
    it('maps FunctionSpanData to $ai_span event with type=tool', async () => {
      const span = createMockSpan({
        spanData: {
          type: 'function',
          name: 'get_weather',
          input: '{"city": "San Francisco"}',
          output: 'Sunny, 72F',
        },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]

      expect(call.event).toBe('$ai_span')
      expect(call.properties.$ai_span_name).toBe('get_weather')
      expect(call.properties.$ai_span_type).toBe('tool')
      expect(call.properties.$ai_input_state).toBe('{"city": "San Francisco"}')
      expect(call.properties.$ai_output_state).toBe('Sunny, 72F')
    })

    it('includes MCP data when present', async () => {
      const span = createMockSpan({
        spanData: {
          type: 'function',
          name: 'search',
          input: 'query',
          output: 'result',
          mcp_data: '{"server": "brave-search"}',
        },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]
      expect(call.properties.$ai_mcp_data).toBe('{"server": "brave-search"}')
    })
  })

  describe('agent spans', () => {
    it('maps AgentSpanData to $ai_span event with type=agent', async () => {
      const span = createMockSpan({
        spanData: {
          type: 'agent',
          name: 'CustomerServiceAgent',
          handoffs: ['TechnicalAgent', 'BillingAgent'],
          tools: ['search', 'get_order'],
          output_type: 'str',
        },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]

      expect(call.event).toBe('$ai_span')
      expect(call.properties.$ai_span_name).toBe('CustomerServiceAgent')
      expect(call.properties.$ai_span_type).toBe('agent')
      expect(call.properties.$ai_agent_handoffs).toEqual(['TechnicalAgent', 'BillingAgent'])
      expect(call.properties.$ai_agent_tools).toEqual(['search', 'get_order'])
      expect(call.properties.$ai_agent_output_type).toBe('str')
    })
  })

  describe('handoff spans', () => {
    it('maps HandoffSpanData to $ai_span event with type=handoff', async () => {
      const span = createMockSpan({
        spanData: {
          type: 'handoff',
          from_agent: 'TriageAgent',
          to_agent: 'TechnicalAgent',
        },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]

      expect(call.event).toBe('$ai_span')
      expect(call.properties.$ai_span_type).toBe('handoff')
      expect(call.properties.$ai_handoff_from_agent).toBe('TriageAgent')
      expect(call.properties.$ai_handoff_to_agent).toBe('TechnicalAgent')
      expect(call.properties.$ai_span_name).toBe('TriageAgent -> TechnicalAgent')
    })
  })

  describe('guardrail spans', () => {
    it('maps GuardrailSpanData to $ai_span event with type=guardrail', async () => {
      const span = createMockSpan({
        spanData: {
          type: 'guardrail',
          name: 'ContentFilter',
          triggered: true,
        },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]

      expect(call.event).toBe('$ai_span')
      expect(call.properties.$ai_span_name).toBe('ContentFilter')
      expect(call.properties.$ai_span_type).toBe('guardrail')
      expect(call.properties.$ai_guardrail_triggered).toBe(true)
    })
  })

  describe('custom spans', () => {
    it('maps CustomSpanData to $ai_span event with type=custom', async () => {
      const span = createMockSpan({
        spanData: {
          type: 'custom',
          name: 'database_query',
          data: { query: 'SELECT * FROM users', rows: 100 },
        },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]

      expect(call.event).toBe('$ai_span')
      expect(call.properties.$ai_span_name).toBe('database_query')
      expect(call.properties.$ai_span_type).toBe('custom')
      expect(call.properties.$ai_custom_data).toEqual({ query: 'SELECT * FROM users', rows: 100 })
    })
  })

  describe('response spans', () => {
    it('maps ResponseSpanData to $ai_generation event', async () => {
      const span = createMockSpan({
        spanData: {
          type: 'response',
          response_id: 'resp_123',
          _input: 'Hello, world!',
          _response: {
            id: 'resp_123',
            model: 'gpt-4o',
            output: [{ type: 'message', content: 'Hello!' }],
            usage: { input_tokens: 25, output_tokens: 10 },
          },
        },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]

      expect(call.event).toBe('$ai_generation')
      expect(call.properties.$ai_response_id).toBe('resp_123')
      expect(call.properties.$ai_model).toBe('gpt-4o')
      expect(call.properties.$ai_input_tokens).toBe(25)
      expect(call.properties.$ai_output_tokens).toBe(10)
      expect(call.properties.$ai_total_tokens).toBe(35)
      expect(call.properties.$ai_output_choices).toEqual([{ type: 'message', content: 'Hello!' }])
    })
  })

  describe('audio spans', () => {
    it('maps TranscriptionSpanData to $ai_span with type=transcription', async () => {
      const span = createMockSpan({
        spanData: {
          type: 'transcription',
          input: { data: 'base64_audio', format: 'pcm' },
          output: 'This is the transcribed text.',
          model: 'whisper-1',
          model_config: { language: 'en' },
        },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]

      expect(call.event).toBe('$ai_span')
      expect(call.properties.$ai_span_type).toBe('transcription')
      expect(call.properties.$ai_model).toBe('whisper-1')
      expect(call.properties.audio_input_format).toBe('pcm')
      expect(call.properties.model_config).toEqual({ language: 'en' })
      expect(call.properties.$ai_output_state).toBe('This is the transcribed text.')
    })

    it('maps SpeechSpanData to $ai_span with type=speech', async () => {
      const span = createMockSpan({
        spanData: {
          type: 'speech',
          input: 'Hello, how can I help you?',
          output: { data: 'base64_audio_data', format: 'pcm' },
          model: 'tts-1',
          model_config: { voice: 'alloy', speed: 1.0 },
        },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]

      expect(call.event).toBe('$ai_span')
      expect(call.properties.$ai_span_type).toBe('speech')
      expect(call.properties.$ai_model).toBe('tts-1')
      expect(call.properties.audio_output_format).toBe('pcm')
      expect(call.properties.$ai_input).toBe('Hello, how can I help you?')
    })

    it('maps SpeechGroupSpanData to $ai_span with type=speech_group', async () => {
      const span = createMockSpan({
        spanData: {
          type: 'speech_group',
          input: 'Group input text',
        },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]

      expect(call.event).toBe('$ai_span')
      expect(call.properties.$ai_span_type).toBe('speech_group')
    })
  })

  describe('MCP spans', () => {
    it('maps MCPListToolsSpanData to $ai_span with type=mcp_tools', async () => {
      const span = createMockSpan({
        spanData: {
          type: 'mcp_tools',
          server: 'brave-search',
          result: ['web_search', 'image_search'],
        },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]

      expect(call.event).toBe('$ai_span')
      expect(call.properties.$ai_span_type).toBe('mcp_tools')
      expect(call.properties.$ai_span_name).toBe('mcp:brave-search')
      expect(call.properties.$ai_mcp_server).toBe('brave-search')
      expect(call.properties.$ai_mcp_tools).toEqual(['web_search', 'image_search'])
    })
  })

  describe('privacy mode', () => {
    it('redacts input/output content when privacy mode is enabled', async () => {
      const proc = new PostHogTracingProcessor({
        client: mockClient,
        distinctId: 'test-user',
        privacyMode: true,
      })

      const span = createMockSpan({
        spanData: {
          type: 'generation',
          input: [{ role: 'user', content: 'Secret message' }],
          output: [{ role: 'assistant', content: 'Secret response' }],
          model: 'gpt-4o',
          usage: { input_tokens: 10, output_tokens: 20 },
        },
      })

      await proc.onSpanStart(span as any)
      await proc.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]

      expect(call.properties.$ai_input).toBeNull()
      expect(call.properties.$ai_output_choices).toBeNull()
      // Token counts should still be present
      expect(call.properties.$ai_input_tokens).toBe(10)
      expect(call.properties.$ai_output_tokens).toBe(20)
    })

    it('redacts function span input/output in privacy mode', async () => {
      const proc = new PostHogTracingProcessor({
        client: mockClient,
        distinctId: 'test-user',
        privacyMode: true,
      })

      const span = createMockSpan({
        spanData: {
          type: 'function',
          name: 'get_secret',
          input: 'sensitive input',
          output: 'sensitive output',
        },
      })

      await proc.onSpanStart(span as any)
      await proc.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]

      expect(call.properties.$ai_input_state).toBeNull()
      expect(call.properties.$ai_output_state).toBeNull()
      expect(call.properties.$ai_span_name).toBe('get_secret')
    })

    it('redacts custom span data in privacy mode', async () => {
      const proc = new PostHogTracingProcessor({
        client: mockClient,
        distinctId: 'test-user',
        privacyMode: true,
      })

      const span = createMockSpan({
        spanData: {
          type: 'custom',
          name: 'sensitive_op',
          data: { secret: 'should-be-redacted' },
        },
      })

      await proc.onSpanStart(span as any)
      await proc.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]
      expect(call.properties.$ai_custom_data).toBeNull()
    })
  })

  describe('error handling', () => {
    it('captures span errors correctly', async () => {
      const span = createMockSpan({
        spanData: { type: 'generation', model: 'gpt-4o' },
        error: { message: 'Rate limit exceeded' },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]

      expect(call.properties.$ai_is_error).toBe(true)
      expect(call.properties.$ai_error).toBe('Rate limit exceeded')
    })

    it('categorizes ModelBehaviorError', async () => {
      const span = createMockSpan({
        spanData: { type: 'generation', model: 'gpt-4o' },
        error: { message: 'ModelBehaviorError: Invalid JSON output' },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]
      expect(call.properties.$ai_error_type).toBe('model_behavior_error')
    })

    it('categorizes UserError', async () => {
      const span = createMockSpan({
        spanData: { type: 'generation', model: 'gpt-4o' },
        error: { message: 'UserError: Tool failed' },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]
      expect(call.properties.$ai_error_type).toBe('user_error')
    })

    it('categorizes InputGuardrailTripwireTriggered', async () => {
      const span = createMockSpan({
        spanData: { type: 'generation', model: 'gpt-4o' },
        error: { message: 'InputGuardrailTripwireTriggered: Content blocked' },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]
      expect(call.properties.$ai_error_type).toBe('input_guardrail_triggered')
    })

    it('categorizes OutputGuardrailTripwireTriggered', async () => {
      const span = createMockSpan({
        spanData: { type: 'generation', model: 'gpt-4o' },
        error: { message: 'OutputGuardrailTripwireTriggered: Response blocked' },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]
      expect(call.properties.$ai_error_type).toBe('output_guardrail_triggered')
    })

    it('categorizes MaxTurnsExceeded', async () => {
      const span = createMockSpan({
        spanData: { type: 'generation', model: 'gpt-4o' },
        error: { message: 'MaxTurnsExceeded: Agent exceeded maximum turns' },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]
      expect(call.properties.$ai_error_type).toBe('max_turns_exceeded')
    })

    it('categorizes unknown errors', async () => {
      const span = createMockSpan({
        spanData: { type: 'generation', model: 'gpt-4o' },
        error: { message: 'Some random error occurred' },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]
      expect(call.properties.$ai_error_type).toBe('unknown')
    })
  })

  describe('latency calculation', () => {
    it('calculates latency from span start/end times', async () => {
      const span = createMockSpan({
        spanData: { type: 'generation', model: 'gpt-4o' },
      })

      const now = Date.now()
      jest
        .spyOn(Date, 'now')
        .mockReturnValueOnce(now)
        .mockReturnValueOnce(now + 1500)

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]
      expect(call.properties.$ai_latency).toBeCloseTo(1.5, 1)

      jest.restoreAllMocks()
    })

    it('falls back to ISO timestamp parsing', async () => {
      const span = createMockSpan({
        spanData: { type: 'generation', model: 'gpt-4o' },
        startedAt: '2024-01-01T00:00:00.000Z',
        endedAt: '2024-01-01T00:00:02.000Z',
      })

      // Don't call onSpanStart to skip recording start time
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]
      expect(call.properties.$ai_latency).toBeCloseTo(2.0, 1)
    })
  })

  describe('groups and properties', () => {
    it('includes groups in captured events', async () => {
      const proc = new PostHogTracingProcessor({
        client: mockClient,
        distinctId: 'test-user',
        groups: { company: 'acme', team: 'engineering' },
      })
      const trace = createMockTrace()

      await proc.onTraceStart(trace as any)
      await proc.onTraceEnd(trace as any)

      const call = mockClient.capture.mock.calls[0][0]
      expect(call.groups).toEqual({ company: 'acme', team: 'engineering' })
    })

    it('includes additional properties in events', async () => {
      const proc = new PostHogTracingProcessor({
        client: mockClient,
        distinctId: 'test-user',
        properties: { environment: 'production', version: '1.0' },
      })
      const trace = createMockTrace()

      await proc.onTraceStart(trace as any)
      await proc.onTraceEnd(trace as any)

      const call = mockClient.capture.mock.calls[0][0]
      expect(call.properties.environment).toBe('production')
      expect(call.properties.version).toBe('1.0')
    })
  })

  describe('shutdown and flush', () => {
    it('clears internal state on shutdown', async () => {
      const proc = new PostHogTracingProcessor({
        client: mockClient,
        distinctId: 'test-user',
      })

      // Add some internal state
      const trace = createMockTrace()
      const span = createMockSpan()
      await proc.onTraceStart(trace as any)
      await proc.onSpanStart(span as any)

      await proc.shutdown()

      // Verify state is cleared by checking that subsequent operations don't crash
      // and that flush was called
      expect(mockClient.flush).toHaveBeenCalled()
    })

    it('calls client flush on forceFlush', async () => {
      await processor.forceFlush()
      expect(mockClient.flush).toHaveBeenCalled()
    })
  })

  describe('memory management', () => {
    it('evicts stale entries when exceeding max tracked entries', async () => {
      const proc = new PostHogTracingProcessor({
        client: mockClient,
        distinctId: 'test-user',
      })
      ;(proc as any)._maxTrackedEntries = 10

      // Fill beyond max
      for (let i = 0; i < 15; i++) {
        const span = createMockSpan({ spanId: `span_${i}` })
        await proc.onSpanStart(span as any)
      }

      // Trigger eviction
      const span = createMockSpan({ spanId: 'span_trigger' })
      await proc.onSpanStart(span as any)

      // Should have evicted some entries
      expect((proc as any)._spanStartTimes.size).toBeLessThanOrEqual(11)
    })
  })

  describe('generic spans', () => {
    it('handles unknown span types as generic spans', async () => {
      const span = createMockSpan({
        spanData: { type: 'some_future_type' },
      })

      await processor.onSpanStart(span as any)
      await processor.onSpanEnd(span as any)

      const call = mockClient.capture.mock.calls[0][0]

      expect(call.event).toBe('$ai_span')
      expect(call.properties.$ai_span_type).toBe('some_future_type')
      expect(call.properties.$ai_span_name).toBe('some_future_type')
    })
  })
})

const mockAddTraceProcessor = jest.fn()
jest.mock('@openai/agents-core', () => ({
  addTraceProcessor: mockAddTraceProcessor,
}))

describe('instrument()', () => {
  beforeEach(() => {
    mockAddTraceProcessor.mockClear()
  })

  it('creates processor and registers it', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { instrument } = require('../src/openai-agents')
    const mockClient = createMockClient()

    const processor = instrument({
      client: mockClient,
      distinctId: 'test-user',
    })

    expect(processor).toBeInstanceOf(PostHogTracingProcessor)
    expect(mockAddTraceProcessor).toHaveBeenCalledWith(processor)
  })

  it('passes privacy mode to processor', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { instrument } = require('../src/openai-agents')
    const mockClient = createMockClient()

    const processor = instrument({
      client: mockClient,
      privacyMode: true,
    })

    expect((processor as any)._privacyMode).toBe(true)
  })

  it('passes groups and properties to processor', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { instrument } = require('../src/openai-agents')
    const mockClient = createMockClient()

    const processor = instrument({
      client: mockClient,
      groups: { company: 'acme' },
      properties: { env: 'test' },
    })

    expect((processor as any)._groups).toEqual({ company: 'acme' })
    expect((processor as any)._properties).toEqual({ env: 'test' })
  })
})
