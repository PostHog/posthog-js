import { PostHog } from 'posthog-node'
import PostHogAnthropic from '../src/anthropic'
import AnthropicOriginal from '@anthropic-ai/sdk'
import { version } from '../package.json'

// Type definitions
interface MockAnthropicResponseOptions {
  content?: string
  tools?: Array<{
    id: string
    name: string
    input: Record<string, any>
  }>
  usage?: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
    server_tool_use?: {
      web_search_requests?: number
    }
  }
  model?: string
  id?: string
  stopReason?: string
}

interface MockStreamChunk {
  type: string
  content_block?: AnthropicOriginal.Messages.ContentBlock
  delta?: {
    type: string
    text?: string
    partial_json?: string
    stop_reason?: string
  }
  index?: number
  message?: Partial<AnthropicOriginal.Messages.Message>
  usage?: Partial<AnthropicOriginal.Messages.Usage> & {
    server_tool_use?: {
      web_search_requests?: number
    }
  }
}

interface CaptureExpectations {
  distinctId?: string
  event?: string
  provider?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  webSearchCount?: number
  httpStatus?: number
  hasInput?: boolean
  hasOutput?: boolean
  properties?: Record<string, any>
  groups?: Record<string, any>
}

interface MockAsyncIterator<T> {
  [Symbol.asyncIterator](): AsyncIterator<T>
}

jest.mock('posthog-node', () => {
  return {
    PostHog: jest.fn().mockImplementation(() => {
      return {
        capture: jest.fn(),
        captureImmediate: jest.fn(),
        privacy_mode: false, // Note: This is the correct property name per PostHog Node SDK
      }
    }),
  }
})

jest.mock('@anthropic-ai/sdk', () => {
  // Mock Messages class
  class MockMessages {
    create(..._args: any[]): any {
      /* will be stubbed in tests */
      return undefined
    }
  }

  // Mock Anthropic class
  class MockAnthropic {
    messages: any
    constructor() {
      this.messages = new MockMessages()
    }
    static Messages = MockMessages
  }

  return {
    __esModule: true,
    default: MockAnthropic,
  }
})

/**
 * Creates a mock Anthropic message response for testing
 * @param options - Configuration for the mock response including content, tools, usage, etc.
 * @returns A fully formed mock Message object
 */
const createMockResponse = (options: MockAnthropicResponseOptions = {}): AnthropicOriginal.Messages.Message => {
  const content: AnthropicOriginal.Messages.ContentBlock[] = []

  if (options.content) {
    content.push({ type: 'text', text: options.content } as AnthropicOriginal.Messages.TextBlock)
  }

  if (options.tools) {
    content.push(
      ...options.tools.map(
        (tool) =>
          ({
            type: 'tool_use',
            id: tool.id,
            name: tool.name,
            input: tool.input,
          }) as AnthropicOriginal.Messages.ToolUseBlock
      )
    )
  }

  return {
    id: options.id || 'msg_test_123',
    type: 'message',
    role: 'assistant',
    model: options.model || 'claude-3-opus-20240229',
    content,
    stop_reason: options.stopReason || 'end_turn',
    stop_sequence: null,
    usage: options.usage || { input_tokens: 20, output_tokens: 10 },
  } as AnthropicOriginal.Messages.Message
}

/**
 * Creates mock stream chunks that simulate Anthropic's streaming response format
 * @param options - Configuration for the mock stream response
 * @returns Array of mock stream chunks in the order they would be received
 */
const createMockStreamChunks = (options: MockAnthropicResponseOptions = {}): MockStreamChunk[] => {
  const chunks: MockStreamChunk[] = []

  // Message start
  chunks.push({
    type: 'message_start',
    message: {
      id: options.id || 'msg_test_123',
      type: 'message',
      role: 'assistant',
      model: options.model || 'claude-3-opus-20240229',
      usage: {
        input_tokens: options.usage?.input_tokens || 20,
        cache_creation_input_tokens: options.usage?.cache_creation_input_tokens || 0,
        cache_read_input_tokens: options.usage?.cache_read_input_tokens || 0,
        output_tokens: 0,
        ...(options.usage?.server_tool_use?.web_search_requests
          ? {
              server_tool_use: { web_search_requests: options.usage.server_tool_use.web_search_requests },
            }
          : {}),
      } as any,
    },
  })

  // Add text content chunks
  if (options.content) {
    chunks.push(
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' } as AnthropicOriginal.Messages.TextBlock,
      },
      ...options.content.split(' ').map((word, i, arr) => ({
        type: 'content_block_delta' as const,
        index: 0,
        delta: { type: 'text_delta', text: word + (i < arr.length - 1 ? ' ' : '') },
      })),
      { type: 'content_block_stop', index: 0 }
    )
  }

  // Add tool chunks
  if (options.tools) {
    options.tools.forEach((tool, toolIndex) => {
      const blockIndex = options.content ? 1 + toolIndex : toolIndex
      const inputString = JSON.stringify(tool.input)
      const chunkSize = Math.ceil(inputString.length / 3)

      chunks.push(
        {
          type: 'content_block_start',
          index: blockIndex,
          content_block: { type: 'tool_use', id: tool.id, name: tool.name } as AnthropicOriginal.Messages.ToolUseBlock,
        },
        ...Array.from({ length: Math.ceil(inputString.length / chunkSize) }, (_, i) => ({
          type: 'content_block_delta' as const,
          index: blockIndex,
          delta: { type: 'input_json_delta', partial_json: inputString.slice(i * chunkSize, (i + 1) * chunkSize) },
        })),
        { type: 'content_block_stop', index: blockIndex }
      )
    })
  }

  // Message end
  chunks.push(
    {
      type: 'message_delta',
      delta: {
        stop_reason: options.stopReason || 'end_turn',
        type: 'stop_reason',
      },
      usage: { output_tokens: options.usage?.output_tokens || 10 },
    },
    { type: 'message_stop' }
  )

  return chunks
}

/**
 * Asserts that PostHog capture was called with expected parameters
 * @param mockClient - The mocked PostHog client
 * @param expectations - Object containing expected values for the capture call
 */
const assertPostHogCapture = (mockClient: PostHog, expectations: CaptureExpectations): void => {
  const captureMock = mockClient.capture as jest.Mock
  expect(captureMock).toHaveBeenCalledTimes(1)

  const [captureArgs] = captureMock.mock.calls
  const { distinctId, event, properties, groups } = captureArgs[0]

  // Map of expectation keys to property keys
  const propertyMap: Record<string, string> = {
    provider: '$ai_provider',
    model: '$ai_model',
    inputTokens: '$ai_input_tokens',
    outputTokens: '$ai_output_tokens',
    cacheReadInputTokens: '$ai_cache_read_input_tokens',
    cacheCreationInputTokens: '$ai_cache_creation_input_tokens',
    webSearchCount: '$ai_web_search_count',
    httpStatus: '$ai_http_status',
  }

  // Check simple expectations
  if (expectations.distinctId !== undefined) expect(distinctId).toBe(expectations.distinctId)
  if (expectations.event !== undefined) expect(event).toBe(expectations.event)
  if (expectations.groups !== undefined) expect(groups).toEqual(expectations.groups)

  // Check mapped properties
  Object.entries(propertyMap).forEach(([key, propKey]) => {
    if (expectations[key as keyof CaptureExpectations] !== undefined) {
      expect(properties[propKey]).toBe(expectations[key as keyof CaptureExpectations])
    }
  })

  // Check input/output presence
  if (expectations.hasInput !== undefined) {
    if (expectations.hasInput) {
      expect(properties['$ai_input']).toBeDefined()
      expect(properties['$ai_input']).not.toBeNull()
    } else {
      expect(properties['$ai_input']).toBeNull()
    }
  }

  if (expectations.hasOutput !== undefined) {
    if (expectations.hasOutput) {
      expect(properties['$ai_output_choices']).toBeDefined()
      expect(properties['$ai_output_choices']).not.toBeNull()
    } else {
      expect(properties['$ai_output_choices']).toBeNull()
    }
  }

  // Check custom properties
  if (expectations.properties) {
    Object.entries(expectations.properties).forEach(([key, value]) => {
      expect(properties[key]).toBe(value)
    })
  }

  // Always check that latency is a number
  expect(typeof properties['$ai_latency']).toBe('number')

  // Always check $ai_lib and $ai_lib_version
  expect(properties['$ai_lib']).toBe('posthog-ai')
  expect(properties['$ai_lib_version']).toBe(version)
}

describe('PostHogAnthropic', () => {
  let mockPostHogClient: PostHog
  let client: PostHogAnthropic
  let mockResponse: AnthropicOriginal.Messages.Message
  let mockStreamChunks: MockStreamChunk[]

  // Helper to wait for async operations to complete
  const waitForAsyncCapture = () => new Promise(process.nextTick)

  // Helper to create async iterator from chunks
  const createMockAsyncIterator = <T>(chunks: T[]): MockAsyncIterator<T> => {
    let index = 0
    return {
      async *[Symbol.asyncIterator]() {
        while (index < chunks.length) {
          yield chunks[index++]
        }
      },
    }
  }

  beforeAll(() => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn('⚠️ Skipping Anthropic tests: No ANTHROPIC_API_KEY environment variable set')
    }
  })

  beforeEach(() => {
    jest.clearAllMocks()

    // Reset the default mocks
    mockPostHogClient = new (PostHog as any)()
    client = new PostHogAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      posthog: mockPostHogClient as any,
    })

    // Set up default mock response
    mockResponse = createMockResponse({
      content: 'Hello from Claude!',
    })

    // Set up default mock stream chunks
    mockStreamChunks = createMockStreamChunks({
      content: 'Hello from Claude!',
    })

    // Mock the create method
    const MessagesMock = AnthropicOriginal.Messages as jest.MockedClass<typeof AnthropicOriginal.Messages>
    ;(MessagesMock.prototype.create as jest.Mock) = jest.fn().mockImplementation((params: any) => {
      if (params.stream) {
        // Return a mock stream
        const mockStream = {
          tee: jest
            .fn()
            .mockReturnValue([createMockAsyncIterator(mockStreamChunks), createMockAsyncIterator(mockStreamChunks)]),
        }
        return Promise.resolve(mockStream)
      }
      return Promise.resolve(mockResponse)
    })
  })

  // Wrap each test with conditional skip
  const conditionalTest = process.env.ANTHROPIC_API_KEY ? test : test.skip

  describe('Message Creation', () => {
    conditionalTest('should handle non-streaming message creation', async () => {
      const response = await client.messages.create({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello Claude' }],
        max_tokens: 100,
        posthogDistinctId: 'test-user-123',
        posthogProperties: { custom_prop: 'test_value' },
      })

      expect(response).toEqual(mockResponse)

      assertPostHogCapture(mockPostHogClient, {
        distinctId: 'test-user-123',
        event: '$ai_generation',
        provider: 'anthropic',
        model: 'claude-3-opus-20240229',
        inputTokens: 20,
        outputTokens: 10,
        httpStatus: 200,
        hasInput: true,
        hasOutput: true,
        properties: { custom_prop: 'test_value' },
      })

      const captureMock = mockPostHogClient.capture as jest.Mock
      const [captureArgs] = captureMock.mock.calls
      const { properties } = captureArgs[0]
      expect(properties['$ai_usage']).toBeDefined()
    })

    conditionalTest('should handle system prompts correctly', async () => {
      mockResponse = createMockResponse({
        content: 'I am a helpful assistant.',
      })

      await client.messages.create({
        model: 'claude-3-opus-20240229',
        system: 'You are a helpful assistant.',
        messages: [{ role: 'user', content: 'Who are you?' }],
        max_tokens: 100,
        posthogDistinctId: 'test-user-123',
      })

      const captureMock = mockPostHogClient.capture as jest.Mock
      const [captureArgs] = captureMock.mock.calls
      const { properties } = captureArgs[0]

      // Check that system prompt is included in input
      expect(properties['$ai_input']).toEqual([
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Who are you?' },
      ])
    })

    conditionalTest('should handle multi-turn conversations', async () => {
      const messages = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi there!' },
        { role: 'user' as const, content: 'How are you?' },
      ]

      await client.messages.create({
        model: 'claude-3-opus-20240229',
        messages,
        max_tokens: 100,
        posthogDistinctId: 'test-user-123',
      })

      const captureMock = mockPostHogClient.capture as jest.Mock
      const [captureArgs] = captureMock.mock.calls
      const { properties } = captureArgs[0]

      expect(properties['$ai_input']).toEqual(messages)
    })
  })

  describe('Streaming Responses', () => {
    conditionalTest('should handle streaming responses', async () => {
      const stream = await client.messages.create({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
        stream: true,
        posthogDistinctId: 'test-user-123',
      })

      // Consume the stream
      const chunks = []
      for await (const chunk of stream) {
        chunks.push(chunk)
      }

      // Allow async capture to complete
      await waitForAsyncCapture()

      assertPostHogCapture(mockPostHogClient, {
        distinctId: 'test-user-123',
        event: '$ai_generation',
        provider: 'anthropic',
        model: 'claude-3-opus-20240229',
        inputTokens: 20,
        outputTokens: 10,
        httpStatus: 200,
        hasInput: true,
        hasOutput: true,
      })
    })

    conditionalTest('should track time to first token in streaming', async () => {
      mockStreamChunks = createMockStreamChunks({
        content: 'Hello from Claude!',
      })

      const stream = await client.messages.create({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Say hello' }],
        max_tokens: 100,
        stream: true,
        posthogDistinctId: 'test-ttft-user',
      })

      // Consume the stream
      for await (const _chunk of stream) {
        // Just consume
      }

      // Allow async capture to complete
      await waitForAsyncCapture()

      const captureMock = mockPostHogClient.capture as jest.Mock
      expect(captureMock).toHaveBeenCalledTimes(1)

      const [captureArgs] = captureMock.mock.calls
      const { properties } = captureArgs[0]

      // Time to first token should be present and be a number
      expect(typeof properties['$ai_time_to_first_token']).toBe('number')
      expect(properties['$ai_time_to_first_token']).toBeGreaterThanOrEqual(0)
      // Time to first token should be less than or equal to total latency
      expect(properties['$ai_time_to_first_token']).toBeLessThanOrEqual(properties['$ai_latency'])
    })

    conditionalTest('should handle streaming with tool calls', async () => {
      mockStreamChunks = createMockStreamChunks({
        content: 'I will check the weather for you.',
        tools: [
          {
            id: 'tool_123',
            name: 'get_weather',
            input: { location: 'San Francisco', units: 'celsius' },
          },
        ],
      })

      const stream = await client.messages.create({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'What is the weather?' }],
        tools: [
          {
            name: 'get_weather',
            description: 'Get the weather',
            input_schema: {
              type: 'object',
              properties: {
                location: { type: 'string' },
                units: { type: 'string' },
              },
            },
          },
        ] as AnthropicOriginal.Tool[],
        max_tokens: 100,
        stream: true,
        posthogDistinctId: 'test-user-123',
      })

      // Consume the stream
      for await (const _chunk of stream) {
        // Just consume
      }

      // Allow async capture to complete
      await waitForAsyncCapture()

      const captureMock = mockPostHogClient.capture as jest.Mock
      const [captureArgs] = captureMock.mock.calls
      const { properties } = captureArgs[0]

      // Check that tools are captured
      expect(properties['$ai_tools']).toBeDefined()
      expect(properties['$ai_output_choices']).toEqual([
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will check the weather for you.' },
            {
              type: 'function',
              id: 'tool_123',
              function: {
                name: 'get_weather',
                arguments: { location: 'San Francisco', units: 'celsius' },
              },
            },
          ],
        },
      ])
    })
  })

  describe('Tool Usage', () => {
    conditionalTest('should handle tool calls in non-streaming mode', async () => {
      mockResponse = createMockResponse({
        content: 'I will search for that information.',
        tools: [
          {
            id: 'tool_456',
            name: 'search',
            input: { query: 'PostHog features' },
          },
        ],
      })

      await client.messages.create({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Tell me about PostHog' }],
        tools: [
          {
            name: 'search',
            description: 'Search for information',
            input_schema: {
              type: 'object',
              properties: {
                query: { type: 'string' },
              },
            },
          },
        ] as AnthropicOriginal.Tool[],
        max_tokens: 100,
        posthogDistinctId: 'test-user-123',
      })

      const captureMock = mockPostHogClient.capture as jest.Mock
      const [captureArgs] = captureMock.mock.calls
      const { properties } = captureArgs[0]

      expect(properties['$ai_tools']).toBeDefined()
      expect(properties['$ai_output_choices']).toEqual([
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will search for that information.' },
            {
              type: 'function',
              id: 'tool_456',
              function: {
                name: 'search',
                arguments: { query: 'PostHog features' },
              },
            },
          ],
        },
      ])
    })

    conditionalTest('should handle multiple tool calls', async () => {
      mockResponse = createMockResponse({
        content: 'Let me check both of those for you.',
        tools: [
          {
            id: 'tool_1',
            name: 'get_weather',
            input: { location: 'New York' },
          },
          {
            id: 'tool_2',
            name: 'get_weather',
            input: { location: 'London' },
          },
        ],
      })

      await client.messages.create({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Weather in New York and London?' }],
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather',
            input_schema: {
              type: 'object',
              properties: {
                location: { type: 'string' },
              },
            },
          },
        ] as AnthropicOriginal.Tool[],
        max_tokens: 100,
        posthogDistinctId: 'test-user-123',
      })

      const captureMock = mockPostHogClient.capture as jest.Mock
      const [captureArgs] = captureMock.mock.calls
      const { properties } = captureArgs[0]

      const outputChoices = properties['$ai_output_choices'][0]
      expect(outputChoices.content).toHaveLength(3) // 1 text + 2 tool calls
      expect(outputChoices.content.filter((c: any) => c.type === 'function')).toHaveLength(2)
    })
  })

  describe('Privacy Mode', () => {
    conditionalTest('should respect local privacy mode', async () => {
      await client.messages.create({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Sensitive information' }],
        max_tokens: 100,
        posthogDistinctId: 'test-user-123',
        posthogPrivacyMode: true,
      })

      assertPostHogCapture(mockPostHogClient, {
        hasInput: false,
        hasOutput: false,
      })
    })

    conditionalTest('should respect global privacy mode', async () => {
      // Set global privacy mode
      ;(mockPostHogClient as any).privacy_mode = true

      await client.messages.create({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Sensitive information' }],
        max_tokens: 100,
        posthogDistinctId: 'test-user-123',
        posthogPrivacyMode: false, // Try to override, but global should take precedence
      })

      assertPostHogCapture(mockPostHogClient, {
        hasInput: false,
        hasOutput: false,
      })
    })
  })

  describe('Token Tracking', () => {
    conditionalTest('should track standard token usage', async () => {
      mockResponse = createMockResponse({
        content: 'Response',
        usage: {
          input_tokens: 50,
          output_tokens: 25,
        },
      })

      await client.messages.create({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
        posthogDistinctId: 'test-user-123',
      })

      assertPostHogCapture(mockPostHogClient, {
        inputTokens: 50,
        outputTokens: 25,
      })
    })

    conditionalTest('should track cache tokens', async () => {
      mockResponse = createMockResponse({
        content: 'Response',
        usage: {
          input_tokens: 100,
          output_tokens: 30,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 15,
        },
      })

      await client.messages.create({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
        posthogDistinctId: 'test-user-123',
      })

      assertPostHogCapture(mockPostHogClient, {
        inputTokens: 100,
        outputTokens: 30,
        cacheCreationInputTokens: 20,
        cacheReadInputTokens: 15,
      })
    })

    conditionalTest('should track tokens in streaming mode', async () => {
      mockStreamChunks = createMockStreamChunks({
        content: 'Streaming response',
        usage: {
          input_tokens: 75,
          output_tokens: 40,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 5,
        },
      })

      const stream = await client.messages.create({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
        stream: true,
        posthogDistinctId: 'test-user-123',
      })

      // Consume the stream
      for await (const _chunk of stream) {
        // Just consume
      }

      // Allow async capture to complete
      await waitForAsyncCapture()

      assertPostHogCapture(mockPostHogClient, {
        inputTokens: 75,
        outputTokens: 40,
        cacheCreationInputTokens: 10,
        cacheReadInputTokens: 5,
      })
    })
  })

  describe('Error Handling', () => {
    conditionalTest('should handle API errors', async () => {
      const apiError = new Error('API Error') as Error & { status: number }
      apiError.status = 429

      const MessagesMock = AnthropicOriginal.Messages as jest.MockedClass<typeof AnthropicOriginal.Messages>
      ;(MessagesMock.prototype.create as jest.Mock) = jest.fn().mockRejectedValue(apiError)

      await expect(
        client.messages.create({
          model: 'claude-3-opus-20240229',
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 100,
          posthogDistinctId: 'test-user-123',
        })
      ).rejects.toThrow('API Error')

      assertPostHogCapture(mockPostHogClient, {
        httpStatus: 429,
        inputTokens: 0,
        outputTokens: 0,
      })

      const captureMock = mockPostHogClient.capture as jest.Mock
      const [captureArgs] = captureMock.mock.calls
      const { properties } = captureArgs[0]

      expect(properties['$ai_error']).toBeDefined()
    })

    conditionalTest('should handle streaming errors', async () => {
      const streamError = new Error('Stream Error') as Error & { status: number }
      streamError.status = 500

      // Create a mock stream that throws an error
      const errorStream = {
        tee: jest.fn().mockReturnValue([
          {
            async *[Symbol.asyncIterator]() {
              throw streamError
              yield
            },
          },
          {
            async *[Symbol.asyncIterator]() {
              throw streamError
              yield
            },
          },
        ]),
      }

      const MessagesMock = AnthropicOriginal.Messages as jest.MockedClass<typeof AnthropicOriginal.Messages>
      ;(MessagesMock.prototype.create as jest.Mock) = jest.fn().mockResolvedValue(errorStream)

      const stream = await client.messages.create({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
        stream: true,
        posthogDistinctId: 'test-user-123',
      })

      // Try to consume the stream (it should throw)
      await expect(async () => {
        for await (const _chunk of stream) {
          // Should throw before getting here
        }
      }).rejects.toThrow('Stream Error')

      // Allow async error capture to complete
      await new Promise(process.nextTick)

      assertPostHogCapture(mockPostHogClient, {
        httpStatus: 500,
        inputTokens: 0,
        outputTokens: 0,
      })
    })
  })

  describe('Additional Features', () => {
    conditionalTest('should handle groups', async () => {
      await client.messages.create({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
        posthogDistinctId: 'test-user-123',
        posthogGroups: { company: 'acme-corp', team: 'engineering' },
      })

      assertPostHogCapture(mockPostHogClient, {
        groups: { company: 'acme-corp', team: 'engineering' },
      })
    })

    conditionalTest('should use captureImmediate when flag is set', async () => {
      await client.messages.create({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
        posthogDistinctId: 'test-user-123',
        posthogCaptureImmediate: true,
      })

      const captureImmediateMock = mockPostHogClient.captureImmediate as jest.Mock
      expect(captureImmediateMock).toHaveBeenCalledTimes(1)
      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(0)
    })

    conditionalTest('should track model parameters', async () => {
      await client.messages.create({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
        temperature: 0.7,
        top_p: 0.9,
        posthogDistinctId: 'test-user-123',
      })

      const captureMock = mockPostHogClient.capture as jest.Mock
      const [captureArgs] = captureMock.mock.calls
      const { properties } = captureArgs[0]

      expect(properties['$ai_model_parameters']).toEqual({
        max_tokens: 100,
        temperature: 0.7,
        top_p: 0.9,
      })
    })

    conditionalTest('should handle anonymous users with trace ID', async () => {
      await client.messages.create({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
        posthogTraceId: 'trace-789',
      })

      const captureMock = mockPostHogClient.capture as jest.Mock
      const [captureArgs] = captureMock.mock.calls
      const { distinctId, properties } = captureArgs[0]

      expect(distinctId).toBe('trace-789')
      expect(properties['$process_person_profile']).toBe(false)
    })

    conditionalTest('should handle identified users without setting $process_person_profile', async () => {
      await client.messages.create({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
        posthogDistinctId: 'user-456',
        posthogTraceId: 'trace-789',
      })

      const captureMock = mockPostHogClient.capture as jest.Mock
      const [captureArgs] = captureMock.mock.calls
      const { distinctId, properties } = captureArgs[0]

      expect(distinctId).toBe('user-456')
      expect(properties['$process_person_profile']).toBeUndefined()
    })
  })

  describe('Web Search Tracking', () => {
    conditionalTest('should track web search count in non-streaming mode', async () => {
      mockResponse = createMockResponse({
        content: 'Based on my search, PostHog is a product analytics platform.',
        usage: {
          input_tokens: 50,
          output_tokens: 30,
          server_tool_use: {
            web_search_requests: 3,
          },
        },
      })

      await client.messages.create({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'What is PostHog?' }],
        max_tokens: 100,
        posthogDistinctId: 'test-user-123',
      })

      assertPostHogCapture(mockPostHogClient, {
        distinctId: 'test-user-123',
        event: '$ai_generation',
        provider: 'anthropic',
        model: 'claude-3-opus-20240229',
        inputTokens: 50,
        outputTokens: 30,
        webSearchCount: 3,
        httpStatus: 200,
        hasInput: true,
        hasOutput: true,
      })
    })

    conditionalTest('should track web search count in streaming mode', async () => {
      mockStreamChunks = createMockStreamChunks({
        content: 'Based on my search results, here is what I found.',
        usage: {
          input_tokens: 60,
          output_tokens: 35,
          server_tool_use: {
            web_search_requests: 2,
          },
        },
      })

      const stream = await client.messages.create({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Search for information about AI' }],
        max_tokens: 100,
        stream: true,
        posthogDistinctId: 'test-user-123',
      })

      // Consume the stream
      for await (const _chunk of stream) {
        // Just consume
      }

      // Allow async capture to complete
      await waitForAsyncCapture()

      assertPostHogCapture(mockPostHogClient, {
        distinctId: 'test-user-123',
        event: '$ai_generation',
        provider: 'anthropic',
        model: 'claude-3-opus-20240229',
        inputTokens: 60,
        outputTokens: 35,
        webSearchCount: 2,
        httpStatus: 200,
        hasInput: true,
        hasOutput: true,
      })
    })

    conditionalTest('should not include web search count when not present', async () => {
      mockResponse = createMockResponse({
        content: 'Regular response without web search',
        usage: {
          input_tokens: 40,
          output_tokens: 20,
        },
      })

      await client.messages.create({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
        posthogDistinctId: 'test-user-123',
      })

      const captureMock = mockPostHogClient.capture as jest.Mock
      const [captureArgs] = captureMock.mock.calls
      const { properties } = captureArgs[0]

      // Should not have web search count property when it's 0 or undefined
      expect(properties['$ai_web_search_count']).toBeUndefined()
    })

    conditionalTest('should track web search in message_delta event during streaming', async () => {
      // Create custom stream chunks with web search in delta event
      const customChunks: MockStreamChunk[] = [
        {
          type: 'message_start',
          message: {
            id: 'msg_test_123',
            type: 'message',
            role: 'assistant',
            model: 'claude-3-opus-20240229',
            usage: {
              input_tokens: 50,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              output_tokens: 0,
            } as AnthropicOriginal.Messages.Usage,
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' } as AnthropicOriginal.Messages.TextBlock,
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Search result' },
        },
        {
          type: 'content_block_stop',
          index: 0,
        },
        {
          type: 'message_delta',
          delta: {
            stop_reason: 'end_turn',
            type: 'stop_reason',
          },
          usage: {
            output_tokens: 25,
            server_tool_use: { web_search_requests: 4 },
          } as any,
        },
        { type: 'message_stop' },
      ]

      mockStreamChunks = customChunks

      const stream = await client.messages.create({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Search query' }],
        max_tokens: 100,
        stream: true,
        posthogDistinctId: 'test-user-123',
      })

      // Consume the stream
      for await (const _chunk of stream) {
        // Just consume
      }

      // Allow async capture to complete
      await waitForAsyncCapture()

      assertPostHogCapture(mockPostHogClient, {
        webSearchCount: 4,
      })
    })
  })
})
