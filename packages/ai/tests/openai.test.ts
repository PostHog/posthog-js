import { PostHog } from 'posthog-node'
import PostHogOpenAI from '../src/openai'
import openaiModule from 'openai'
import type { ChatCompletion, ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { ParsedResponse } from 'openai/resources/responses/responses'
import { flushPromises } from './test-utils'
import { version } from '../package.json'

// Test-specific helper interface for async iteration
interface MockAsyncIterator<T> {
  [Symbol.asyncIterator](): AsyncIterator<T>
}

let mockOpenAiChatResponse: ChatCompletion = {} as ChatCompletion
let mockOpenAiParsedResponse: ParsedResponse<any> = {} as ParsedResponse<any>
let mockOpenAiEmbeddingResponse: any = {}
let mockStreamChunks: ChatCompletionChunk[] = []

jest.mock('posthog-node', () => {
  return {
    PostHog: jest.fn().mockImplementation(() => {
      return {
        capture: jest.fn(),
        captureImmediate: jest.fn(),
        privacy_mode: false,
      }
    }),
  }
})

jest.mock('openai', () => {
  // Mock Completions class – `create` is declared on the prototype so that
  // subclasses can safely `super.create(...)` without it being shadowed by an
  // instance field (which would overwrite the subclass implementation).
  class MockCompletions {
    constructor() {}
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    create(..._args: any[]): any {
      /* will be stubbed in beforeEach */
      return undefined
    }
  }

  // Mock Chat class
  class MockChat {
    constructor() {}
    static Completions = MockCompletions
  }

  // Mock Responses class with parse method that will be called by super.parse()
  class MockResponses {
    constructor() {}
    // These need to be on the prototype for super.parse() to work
    create() {
      return Promise.resolve({})
    }
    parse() {
      return Promise.resolve({})
    }
  }

  // Mock Embeddings class
  class MockEmbeddings {
    constructor() {}
    create() {
      return Promise.resolve({})
    }
  }

  // Mock Transcriptions class
  class MockTranscriptions {
    constructor() {}
    create() {
      return Promise.resolve({})
    }
  }

  // Mock Audio class
  class MockAudio {
    constructor() {}
    static Transcriptions = MockTranscriptions
  }

  // Mock OpenAI class
  class MockOpenAI {
    chat: any
    embeddings: any
    responses: any
    audio: any
    constructor() {
      this.chat = {
        completions: {
          create: jest.fn(),
        },
      }
      this.embeddings = {
        create: jest.fn(),
      }
      this.responses = {
        create: jest.fn(),
      }
      this.audio = {
        transcriptions: {
          create: jest.fn(),
        },
      }
    }
    static Chat = MockChat
    static Responses = MockResponses
    static Embeddings = MockEmbeddings
    static Audio = MockAudio
  }

  return {
    __esModule: true,
    default: MockOpenAI,
    OpenAI: MockOpenAI,
    Chat: MockChat,
    Responses: MockResponses,
    Embeddings: MockEmbeddings,
    Audio: MockAudio,
  }
})

/**
 * Helper function to create an async iterator from stream chunks
 * Used to simulate OpenAI's streaming response behavior
 */
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

/**
 * Creates mock stream chunks for testing streaming completions
 * @param options Configuration for the mock stream response
 * @returns Array of properly typed ChatCompletionChunk objects
 */
const createMockStreamChunks = (options: {
  content?: string
  includeToolCalls?: boolean
  toolCallName?: string
  toolCallArguments?: string
  includeUsage?: boolean
}): ChatCompletionChunk[] => {
  const chunks: ChatCompletionChunk[] = []
  const baseChunk: Partial<ChatCompletionChunk> = {
    id: 'chatcmpl-test',
    model: 'gpt-4',
    object: 'chat.completion.chunk',
    created: Date.now() / 1000,
  }

  if (options.content) {
    // Split content into multiple chunks to simulate real streaming
    const words = options.content.split(' ')
    for (let i = 0; i < words.length; i++) {
      chunks.push({
        ...baseChunk,
        choices: [
          {
            index: 0,
            delta: {
              content: words[i] + (i < words.length - 1 ? ' ' : ''),
            },
            finish_reason: null,
            logprobs: null,
          },
        ],
      } as ChatCompletionChunk)
    }
  }

  if (options.includeToolCalls) {
    // Tool call chunks come in sequence: id/name first, then arguments in parts
    chunks.push({
      ...baseChunk,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_abc123',
                type: 'function',
                function: {
                  name: options.toolCallName || 'get_weather',
                  arguments: '',
                },
              },
            ],
          },
          finish_reason: null,
          logprobs: null,
        },
      ],
    } as ChatCompletionChunk)

    // Stream the arguments in parts
    const args = options.toolCallArguments || '{"location": "San Francisco", "unit": "celsius"}'
    const argChunks = [args.slice(0, 10), args.slice(10, 30), args.slice(30)]

    for (const argChunk of argChunks) {
      chunks.push({
        ...baseChunk,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: {
                    arguments: argChunk,
                  },
                },
              ],
            },
            finish_reason: null,
            logprobs: null,
          },
        ],
      } as ChatCompletionChunk)
    }
  }

  // Add final chunk with finish reason and optional usage
  const finalChunk: ChatCompletionChunk = {
    ...baseChunk,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
  } as ChatCompletionChunk

  if (options.includeUsage) {
    finalChunk.usage = {
      prompt_tokens: 25,
      completion_tokens: 15,
      total_tokens: 40,
    }
  }

  chunks.push(finalChunk)
  return chunks
}

describe('PostHogOpenAI - Jest test suite', () => {
  let mockPostHogClient: PostHog
  let client: PostHogOpenAI

  beforeAll(() => {
    if (!process.env.OPENAI_API_KEY) {
      console.warn('⚠️ Skipping OpenAI tests: No OPENAI_API_KEY environment variable set')
    }
  })

  beforeEach(() => {
    // Skip all tests if no API key is present
    if (!process.env.OPENAI_API_KEY) {
      return
    }

    jest.clearAllMocks()

    // Reset the default mocks
    mockPostHogClient = new (PostHog as any)()
    client = new PostHogOpenAI({
      apiKey: process.env.OPENAI_API_KEY || '',
      posthog: mockPostHogClient as any,
    })

    // Default chat completion mock for non-streaming responses
    mockOpenAiChatResponse = {
      id: 'test-response-id',
      model: 'gpt-4',
      object: 'chat.completion',
      created: Date.now() / 1000,
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'Hello from OpenAI!',
            refusal: null,
          },
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 10,
        total_tokens: 30,
      },
    }

    // Some default parsed response mock
    mockOpenAiParsedResponse = {
      id: 'test-parsed-response-id',
      model: 'gpt-4o-2024-08-06',
      object: 'response',
      created_at: Date.now(),
      status: 'completed',
      output: [
        {
          id: 'msg-001',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: '{"name": "Science Fair", "date": "Friday", "participants": ["Alice", "Bob"]}',
            },
          ],
        } as any,
      ],
      output_parsed: {
        name: 'Science Fair',
        date: 'Friday',
        participants: ['Alice', 'Bob'],
      },
      usage: {
        input_tokens: 15,
        output_tokens: 20,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 5 },
        total_tokens: 35,
      },
      // Additional required fields for ParsedResponse
      output_text: '',
      error: null,
      incomplete_details: null,
      instructions: '',
      input: [],
      metadata: null,
      response_id: 'test-parsed-response-id',
      service_tier: null,
      system_fingerprint: null,
      queue_time: null,
      parallel_tool_calls: true,
      temperature: 1.0,
      tool_choice: 'auto',
      tools: [],
      top_p: 1.0,
    } as unknown as ParsedResponse<any>

    // Default embeddings response
    mockOpenAiEmbeddingResponse = {
      object: 'list',
      data: [
        {
          object: 'embedding',
          embedding: new Array(1536).fill(0).map(() => Math.random()),
          index: 0,
        },
      ],
      model: 'text-embedding-3-small',
      usage: {
        prompt_tokens: 5,
        total_tokens: 5,
      },
    }

    // Default stream chunks for streaming tests
    mockStreamChunks = createMockStreamChunks({
      content: 'Hello from streaming OpenAI!',
      includeUsage: true,
    })

    const ChatMock: any = openaiModule.Chat
    ;(ChatMock.Completions as any).prototype.create = jest.fn().mockImplementation((params: any) => {
      if (params.stream) {
        // Return a mock stream with tee() method
        const mockStream = {
          tee: jest
            .fn()
            .mockReturnValue([createMockAsyncIterator(mockStreamChunks), createMockAsyncIterator(mockStreamChunks)]),
        }
        return Promise.resolve(mockStream)
      }
      return Promise.resolve(mockOpenAiChatResponse)
    })

    // Mock the Responses.prototype.parse method that super.parse() will call
    const ResponsesMock: any = openaiModule.Responses
    ResponsesMock.prototype.parse = jest.fn().mockResolvedValue(mockOpenAiParsedResponse)
    ResponsesMock.prototype.create = jest.fn().mockResolvedValue(mockOpenAiParsedResponse)

    // Mock the Embeddings class
    const EmbeddingsMock: any = openaiModule.Embeddings || class MockEmbeddings {}
    EmbeddingsMock.prototype.create = jest.fn().mockResolvedValue(mockOpenAiEmbeddingResponse)
  })

  // Conditionally run tests based on API key availability
  const conditionalTest = process.env.OPENAI_API_KEY ? test : test.skip

  conditionalTest('basic completion', async () => {
    // We ensure calls to create a completion return our mock
    // This is handled by the inherited Chat.Completions mock in openai
    const response = await client.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      posthogDistinctId: 'test-id',
      posthogProperties: { foo: 'bar' },
    })

    expect(response).toEqual(mockOpenAiChatResponse)
    // We expect 1 capture call
    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    // Check the capture arguments
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { distinctId, event, properties } = captureArgs[0]

    expect(distinctId).toBe('test-id')
    expect(event).toBe('$ai_generation')
    expect(properties['$ai_lib']).toBe('posthog-ai')
    expect(properties['$ai_lib_version']).toBe(version)
    expect(properties['$ai_provider']).toBe('openai')
    expect(properties['$ai_model']).toBe('gpt-4')
    expect(properties['$ai_input']).toEqual([{ role: 'user', content: 'Hello' }])
    // Updated to match new formatted output structure
    expect(properties['$ai_output_choices']).toEqual([
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Hello from OpenAI!',
          },
        ],
      },
    ])
    expect(properties['$ai_input_tokens']).toBe(20)
    expect(properties['$ai_output_tokens']).toBe(10)
    expect(properties['$ai_http_status']).toBe(200)
    expect(properties['foo']).toBe('bar')
    expect(typeof properties['$ai_latency']).toBe('number')
  })

  conditionalTest('groups', async () => {
    await client.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      posthogDistinctId: 'test-id',
      posthogGroups: { company: 'test_company' },
    })
    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { groups } = captureArgs[0]
    expect(groups).toEqual({ company: 'test_company' })
  })

  conditionalTest('privacy mode local', async () => {
    await client.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      posthogDistinctId: 'test-id',
      posthogPrivacyMode: true,
    })

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { properties } = captureArgs[0]
    expect(properties['$ai_input']).toBeNull()
    expect(properties['$ai_output_choices']).toBeNull()
  })

  conditionalTest('privacy mode global', async () => {
    // override mock to appear globally in privacy mode
    ;(mockPostHogClient as any).privacy_mode = true

    await client.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      posthogDistinctId: 'test-id',
      // we attempt to override locally, but it should still be null if global is true
      posthogPrivacyMode: false,
    })

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { properties } = captureArgs[0]
    expect(properties['$ai_input']).toBeNull()
    expect(properties['$ai_output_choices']).toBeNull()
  })

  conditionalTest('core model params', async () => {
    mockOpenAiChatResponse.usage = {
      prompt_tokens: 20,
      completion_tokens: 10,
      total_tokens: 30,
    }

    await client.chat.completions.create({
      model: 'gpt-4',
      // using openai-like params
      temperature: 0.5,
      max_completion_tokens: 100,
      stream: false,
      messages: [{ role: 'user', content: 'Hello' }],
      posthogDistinctId: 'test-id',
      posthogProperties: { foo: 'bar' },
    })

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { properties } = captureArgs[0]

    expect(properties['$ai_model_parameters']).toEqual({
      temperature: 0.5,
      max_completion_tokens: 100,
      stream: false,
    })
    expect(properties['foo']).toBe('bar')
  })

  conditionalTest('reasoning and cache tokens', async () => {
    // Set up mock response with standard token usage
    mockOpenAiChatResponse.usage = {
      prompt_tokens: 20,
      completion_tokens: 10,
      total_tokens: 30,
      // Add the detailed token usage that OpenAI would return
      completion_tokens_details: {
        reasoning_tokens: 15,
      },
      prompt_tokens_details: {
        cached_tokens: 5,
      },
    }

    // Create a completion with additional token tracking
    await client.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      posthogDistinctId: 'test-id',
      posthogProperties: { foo: 'bar' },
    })

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { properties } = captureArgs[0]

    // Check standard token properties
    expect(properties['$ai_input_tokens']).toBe(20)
    expect(properties['$ai_output_tokens']).toBe(10)

    // Check the new token properties
    expect(properties['$ai_reasoning_tokens']).toBe(15)
    expect(properties['$ai_cache_read_input_tokens']).toBe(5)
  })

  // New test: ensure captureImmediate is used when flag is set
  conditionalTest('captureImmediate flag', async () => {
    await client.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      posthogDistinctId: 'test-id',
      posthogCaptureImmediate: true,
    })

    // captureImmediate should be called once, and capture should not be called
    expect(mockPostHogClient.captureImmediate).toHaveBeenCalledTimes(1)
    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(0)
  })

  conditionalTest('responses parse', async () => {
    const response = await client.responses.parse({
      model: 'gpt-4o-2024-08-06',
      input: [
        { role: 'system', content: 'Extract the event information.' },
        { role: 'user', content: 'Alice and Bob are going to a science fair on Friday.' },
      ],
      text: {
        format: {
          type: 'json_object',
          json_schema: {
            name: 'event',
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                date: { type: 'string' },
                participants: { type: 'array', items: { type: 'string' } },
              },
              required: ['name', 'date', 'participants'],
            },
          },
        },
      },
      posthogDistinctId: 'test-id',
      posthogProperties: { foo: 'bar' },
    })

    expect(response).toEqual(mockOpenAiParsedResponse)
    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)

    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { distinctId, event, properties } = captureArgs[0]

    expect(distinctId).toBe('test-id')
    expect(event).toBe('$ai_generation')
    expect(properties['$ai_lib']).toBe('posthog-ai')
    expect(properties['$ai_lib_version']).toBe(version)
    expect(properties['$ai_provider']).toBe('openai')
    expect(properties['$ai_model']).toBe('gpt-4o-2024-08-06')
    expect(properties['$ai_input']).toEqual([
      { role: 'system', content: 'Extract the event information.' },
      { role: 'user', content: 'Alice and Bob are going to a science fair on Friday.' },
    ])
    expect(properties['$ai_output_choices']).toEqual(mockOpenAiParsedResponse.output)
    expect(properties['$ai_input_tokens']).toBe(15)
    expect(properties['$ai_output_tokens']).toBe(20)
    expect(properties['$ai_reasoning_tokens']).toBe(5)
    expect(properties['$ai_cache_read_input_tokens']).toBeUndefined()
    expect(properties['$ai_http_status']).toBe(200)
    expect(properties['foo']).toBe('bar')
    expect(typeof properties['$ai_latency']).toBe('number')
  })

  conditionalTest('responses parse with instructions parameter', async () => {
    const response = await client.responses.parse({
      model: 'gpt-4o-2024-08-06',
      input: [{ role: 'user', content: 'Alice and Bob are going to a science fair on Friday.' }],
      instructions: 'Extract the event information.',
      text: {
        format: {
          type: 'json_object',
          json_schema: {
            name: 'event',
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                date: { type: 'string' },
                participants: { type: 'array', items: { type: 'string' } },
              },
              required: ['name', 'date', 'participants'],
            },
          },
        },
      },
      posthogDistinctId: 'test-instructions-id',
    })

    expect(response).toEqual(mockOpenAiParsedResponse)
    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)

    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { distinctId, event, properties } = captureArgs[0]

    expect(distinctId).toBe('test-instructions-id')
    expect(event).toBe('$ai_generation')
    expect(properties['$ai_provider']).toBe('openai')
    expect(properties['$ai_model']).toBe('gpt-4o-2024-08-06')
    expect(properties['$ai_input']).toEqual([
      { role: 'system', content: 'Extract the event information.' },
      { role: 'user', content: 'Alice and Bob are going to a science fair on Friday.' },
    ])
  })

  conditionalTest('anonymous user - $process_person_profile set to false', async () => {
    await client.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      posthogTraceId: 'trace-123',
    })

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { distinctId, properties } = captureArgs[0]

    expect(distinctId).toBe('trace-123')
    expect(properties['$process_person_profile']).toBe(false)
  })

  conditionalTest('identified user - $process_person_profile not set', async () => {
    await client.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      posthogDistinctId: 'user-456',
      posthogTraceId: 'trace-123',
    })

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { distinctId, properties } = captureArgs[0]

    expect(distinctId).toBe('user-456')
    expect(properties['$process_person_profile']).toBeUndefined()
  })

  describe('Streaming Responses', () => {
    conditionalTest('handles basic streaming completion', async () => {
      // Create a simple streaming response
      mockStreamChunks = createMockStreamChunks({
        content: 'This is a streaming response',
        includeUsage: true,
      })

      const stream = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Tell me about streaming' }],
        stream: true,
        posthogDistinctId: 'test-stream-user',
        posthogProperties: { streamTest: true },
      })

      // Consume the stream to trigger the monitoring
      const chunks = []
      for await (const chunk of stream) {
        chunks.push(chunk)
      }

      // Verify we received all chunks
      expect(chunks.length).toBeGreaterThan(0)

      // Wait for async capture to complete
      await flushPromises()

      // Verify PostHog was called with correct data
      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { distinctId, event, properties } = captureArgs[0]

      expect(distinctId).toBe('test-stream-user')
      expect(event).toBe('$ai_generation')
      expect(properties['$ai_lib']).toBe('posthog-ai')
      expect(properties['$ai_lib_version']).toBe(version)
      expect(properties['$ai_provider']).toBe('openai')
      expect(properties['$ai_model']).toBe('gpt-4')

      // Check the formatted output structure
      expect(properties['$ai_output_choices']).toEqual([
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'This is a streaming response',
            },
          ],
        },
      ])

      expect(properties['$ai_input_tokens']).toBe(25)
      expect(properties['$ai_output_tokens']).toBe(15)
      expect(properties['streamTest']).toBe(true)
    })

    conditionalTest('handles streaming with tool calls', async () => {
      // Create stream chunks with tool calls
      mockStreamChunks = createMockStreamChunks({
        content: 'Let me check the weather for you.',
        includeToolCalls: true,
        toolCallName: 'get_current_weather',
        toolCallArguments: '{"location": "New York", "unit": "fahrenheit"}',
        includeUsage: true,
      })

      const stream = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'What is the weather?' }],
        stream: true,
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_current_weather',
              description: 'Get the current weather in a location',
              parameters: {
                type: 'object',
                properties: {
                  location: { type: 'string' },
                  unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
                },
                required: ['location'],
              },
            },
          },
        ],
        posthogDistinctId: 'test-tools-user',
      })

      // Consume the stream
      for await (const _chunk of stream) {
        // Just consume the chunks
      }

      // Wait for async capture
      await flushPromises()

      // Verify the capture includes tool calls in the formatted output
      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      // Check that output contains both text and function call
      expect(properties['$ai_output_choices']).toEqual([
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Let me check the weather for you.',
            },
            {
              type: 'function',
              id: 'call_abc123',
              function: {
                name: 'get_current_weather',
                arguments: '{"location": "New York", "unit": "fahrenheit"}',
              },
            },
          ],
        },
      ])

      // Verify tools were captured
      expect(properties['$ai_tools']).toBeDefined()
      expect(properties['$ai_tools']).toHaveLength(1)
      expect(properties['$ai_tools'][0].function.name).toBe('get_current_weather')
    })

    conditionalTest('handles multiple tool calls in streaming', async () => {
      // Create custom chunks with multiple tool calls
      const multiToolChunks: ChatCompletionChunk[] = [
        {
          id: 'chatcmpl-multi',
          model: 'gpt-4',
          object: 'chat.completion.chunk',
          created: Date.now() / 1000,
          choices: [
            {
              index: 0,
              delta: {
                content: 'I will check both weather and news for you.',
              },
              finish_reason: null,
              logprobs: null,
            },
          ],
        } as ChatCompletionChunk,
        // First tool call
        {
          id: 'chatcmpl-multi',
          model: 'gpt-4',
          object: 'chat.completion.chunk',
          created: Date.now() / 1000,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_weather',
                    type: 'function',
                    function: {
                      name: 'get_weather',
                      arguments: '{"loc',
                    },
                  },
                ],
              },
              finish_reason: null,
              logprobs: null,
            },
          ],
        } as ChatCompletionChunk,
        {
          id: 'chatcmpl-multi',
          model: 'gpt-4',
          object: 'chat.completion.chunk',
          created: Date.now() / 1000,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: 'ation": "NYC"}',
                    },
                  },
                ],
              },
              finish_reason: null,
              logprobs: null,
            },
          ],
        } as ChatCompletionChunk,
        // Second tool call
        {
          id: 'chatcmpl-multi',
          model: 'gpt-4',
          object: 'chat.completion.chunk',
          created: Date.now() / 1000,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 1,
                    id: 'call_news',
                    type: 'function',
                    function: {
                      name: 'get_news',
                      arguments: '{"topic": "technology"}',
                    },
                  },
                ],
              },
              finish_reason: null,
              logprobs: null,
            },
          ],
        } as ChatCompletionChunk,
        // Final chunk
        {
          id: 'chatcmpl-multi',
          model: 'gpt-4',
          object: 'chat.completion.chunk',
          created: Date.now() / 1000,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: 'stop',
              logprobs: null,
            },
          ],
          usage: {
            prompt_tokens: 30,
            completion_tokens: 20,
            total_tokens: 50,
          },
        } as ChatCompletionChunk,
      ]

      mockStreamChunks = multiToolChunks

      const stream = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Weather and news?' }],
        stream: true,
        posthogDistinctId: 'multi-tool-user',
      })

      // Consume the stream
      for await (const _chunk of stream) {
        // Just consume
      }

      // Wait for async capture
      await flushPromises()

      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      // Verify both tool calls are in the output
      const outputContent = properties['$ai_output_choices'][0].content
      expect(outputContent).toHaveLength(3) // text + 2 function calls
      expect(outputContent[0].type).toBe('text')
      expect(outputContent[1].type).toBe('function')
      expect(outputContent[1].function.name).toBe('get_weather')
      expect(outputContent[2].type).toBe('function')
      expect(outputContent[2].function.name).toBe('get_news')
    })

    conditionalTest('handles streaming errors gracefully', async () => {
      // Mock a stream that throws an error
      const errorStream = {
        tee: jest.fn().mockReturnValue([
          {
            [Symbol.asyncIterator]: async function* () {
              yield {
                id: 'error-chunk',
                model: 'gpt-4',
                object: 'chat.completion.chunk',
                created: Date.now() / 1000,
                choices: [
                  {
                    index: 0,
                    delta: { content: 'Starting...' },
                    finish_reason: null,
                  },
                ],
              }
              const error = new Error('Stream interrupted') as Error & { status: number }
              error.status = 503
              throw error
            },
          },
          {
            [Symbol.asyncIterator]: async function* () {
              const error = new Error('Stream interrupted') as Error & { status: number }
              error.status = 503
              throw error
              yield // Adding yield to satisfy generator function requirement
            },
          },
        ]),
      }

      const ChatMock: any = openaiModule.Chat
      ;(ChatMock.Completions as any).prototype.create = jest.fn().mockResolvedValue(errorStream)

      const stream = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Test error' }],
        stream: true,
        posthogDistinctId: 'error-user',
      })

      // Try to consume the stream (should throw)
      await expect(async () => {
        for await (const _chunk of stream) {
          // Should throw before completing
        }
      }).rejects.toThrow('Stream interrupted')

      // Wait for error capture
      await flushPromises()

      // Verify error was captured
      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      expect(properties['$ai_http_status']).toBe(503)
      expect(properties['$ai_error']).toBeDefined()
      // Error is JSON stringified, so check for status code
      expect(properties['$ai_error']).toContain('503')
    })

    conditionalTest('tracks time to first token in streaming', async () => {
      // Create a simple streaming response with content
      mockStreamChunks = createMockStreamChunks({
        content: 'Hello world',
        includeUsage: true,
      })

      const stream = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Say hello' }],
        stream: true,
        posthogDistinctId: 'test-ttft-user',
      })

      // Consume the stream
      for await (const _chunk of stream) {
        // Just consume
      }

      // Wait for async capture to complete
      await flushPromises()

      // Verify PostHog was called with time to first token
      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      // Time to first token should be present and be a number
      expect(typeof properties['$ai_time_to_first_token']).toBe('number')
      expect(properties['$ai_time_to_first_token']).toBeGreaterThanOrEqual(0)
      // Time to first token should be less than or equal to total latency
      expect(properties['$ai_time_to_first_token']).toBeLessThanOrEqual(properties['$ai_latency'])
    })

    conditionalTest('handles empty streaming response', async () => {
      // Create chunks with no content
      mockStreamChunks = [
        {
          id: 'empty-stream',
          model: 'gpt-4',
          object: 'chat.completion.chunk',
          created: Date.now() / 1000,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: 'stop',
              logprobs: null,
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 0,
            total_tokens: 10,
          },
        } as ChatCompletionChunk,
      ]

      const stream = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Empty test' }],
        stream: true,
        posthogDistinctId: 'empty-user',
      })

      // Consume the stream
      for await (const _chunk of stream) {
        // Just consume
      }

      // Wait for capture
      await flushPromises()

      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      // Should have empty text content
      expect(properties['$ai_output_choices']).toEqual([
        {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
        },
      ])
      expect(properties['$ai_output_tokens']).toBe(0)
    })
  })

  describe('Embeddings', () => {
    conditionalTest('basic embeddings', async () => {
      const response = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: 'Hello world',
        posthogDistinctId: 'test-id',
        posthogProperties: { test: 'embeddings' },
      })

      expect(response).toEqual(mockOpenAiEmbeddingResponse)
      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)

      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { distinctId, event, properties } = captureArgs[0]

      expect(distinctId).toBe('test-id')
      expect(event).toBe('$ai_embedding')
      expect(properties['$ai_provider']).toBe('openai')
      expect(properties['$ai_model']).toBe('text-embedding-3-small')
      expect(properties['$ai_input']).toBe('Hello world')
      expect(properties['$ai_output_choices']).toBeNull() // Embeddings don't have output
      expect(properties['$ai_input_tokens']).toBe(5)
      expect(properties['$ai_output_tokens']).toBeUndefined() // Embeddings don't send output tokens
      expect(properties['$ai_http_status']).toBe(200)
      expect(properties['test']).toBe('embeddings')
      expect(typeof properties['$ai_latency']).toBe('number')
    })

    conditionalTest('embeddings with array input', async () => {
      const arrayInput = ['Hello', 'World', 'Test']
      mockOpenAiEmbeddingResponse = {
        object: 'list',
        data: [
          {
            object: 'embedding',
            embedding: new Array(1536).fill(0).map(() => Math.random()),
            index: 0,
          },
          {
            object: 'embedding',
            embedding: new Array(1536).fill(0).map(() => Math.random()),
            index: 1,
          },
          {
            object: 'embedding',
            embedding: new Array(1536).fill(0).map(() => Math.random()),
            index: 2,
          },
        ],
        model: 'text-embedding-3-small',
        usage: {
          prompt_tokens: 8,
          total_tokens: 8,
        },
      }

      const EmbeddingsMock: any = openaiModule.Embeddings || class MockEmbeddings {}
      EmbeddingsMock.prototype.create = jest.fn().mockResolvedValue(mockOpenAiEmbeddingResponse)

      const response = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: arrayInput,
        posthogDistinctId: 'test-array-id',
      })

      expect(response).toEqual(mockOpenAiEmbeddingResponse)
      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)

      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      expect(properties['$ai_input']).toEqual(arrayInput)
      expect(properties['$ai_output_choices']).toBeNull() // Embeddings don't have output
      expect(properties['$ai_input_tokens']).toBe(8)
      expect(properties['$ai_output_tokens']).toBeUndefined() // Embeddings don't send output tokens
    })

    conditionalTest('embeddings privacy mode', async () => {
      await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: 'Sensitive data',
        posthogDistinctId: 'test-id',
        posthogPrivacyMode: true,
      })

      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      expect(properties['$ai_input']).toBeNull()
      expect(properties['$ai_output_choices']).toBeNull()
    })

    conditionalTest('embeddings error handling', async () => {
      const EmbeddingsMock: any = openaiModule.Embeddings || class MockEmbeddings {}
      const testError = new Error('API Error') as Error & { status: number }
      testError.status = 400
      EmbeddingsMock.prototype.create = jest.fn().mockRejectedValue(testError)

      await expect(
        client.embeddings.create({
          model: 'text-embedding-3-small',
          input: 'Test input',
          posthogDistinctId: 'error-user',
        })
      ).rejects.toThrow('API Error')

      // Verify error was captured
      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      expect(properties['$ai_http_status']).toBe(400)
      expect(properties['$ai_is_error']).toBe(true)
      expect(properties['$ai_error']).toContain('400')
    })

    conditionalTest('embeddings captureImmediate flag', async () => {
      await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: 'Test input',
        posthogDistinctId: 'test-id',
        posthogCaptureImmediate: true,
      })

      // captureImmediate should be called once, and capture should not be called
      expect(mockPostHogClient.captureImmediate).toHaveBeenCalledTimes(1)
      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(0)
    })
  })

  describe('Transcriptions', () => {
    let mockTranscriptionResponse: any

    beforeEach(() => {
      // Default transcription response
      mockTranscriptionResponse = {
        text: 'Hello, this is a test transcription.',
      }

      // Mock the Audio.Transcriptions.prototype.create method
      const AudioMock: any = openaiModule.Audio
      const TranscriptionsMock = AudioMock.Transcriptions
      TranscriptionsMock.prototype.create = jest.fn().mockResolvedValue(mockTranscriptionResponse)
    })

    conditionalTest('basic transcription', async () => {
      const mockFile = new Blob(['mock audio data'], { type: 'audio/mpeg' }) as any
      mockFile.name = 'test.mp3'

      const response = await client.audio.transcriptions.create({
        file: mockFile,
        model: 'whisper-1',
        posthogDistinctId: 'test-transcription-user',
        posthogProperties: { test: 'transcription' },
      })

      expect(response).toEqual(mockTranscriptionResponse)
      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)

      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { distinctId, event, properties } = captureArgs[0]

      expect(distinctId).toBe('test-transcription-user')
      expect(event).toBe('$ai_generation')
      expect(properties['$ai_lib']).toBe('posthog-ai')
      expect(properties['$ai_lib_version']).toBe(version)
      expect(properties['$ai_provider']).toBe('openai')
      expect(properties['$ai_model']).toBe('whisper-1')
      expect(properties['$ai_output_choices']).toBe('Hello, this is a test transcription.')
      expect(properties['$ai_http_status']).toBe(200)
      expect(properties['test']).toBe('transcription')
      expect(typeof properties['$ai_latency']).toBe('number')
      expect(properties['$ai_input_tokens']).toBe(0)
      expect(properties['$ai_output_tokens']).toBe(0)
    })

    conditionalTest('transcription with prompt', async () => {
      const mockFile = new Blob(['mock audio data'], { type: 'audio/mpeg' }) as any
      mockFile.name = 'test.mp3'

      await client.audio.transcriptions.create({
        file: mockFile,
        model: 'whisper-1',
        prompt: 'This is a test prompt to guide transcription.',
        posthogDistinctId: 'test-user',
      })

      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      expect(properties['$ai_input']).toBe('This is a test prompt to guide transcription.')
    })

    conditionalTest('transcription with language parameter', async () => {
      const mockFile = new Blob(['mock audio data'], { type: 'audio/mpeg' }) as any
      mockFile.name = 'test.mp3'

      await client.audio.transcriptions.create({
        file: mockFile,
        model: 'whisper-1',
        language: 'en',
        posthogDistinctId: 'test-user',
      })

      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      expect(properties['$ai_model_parameters']).toMatchObject({
        language: 'en',
      })
    })

    conditionalTest('transcription verbose json format', async () => {
      const mockVerboseResponse = {
        language: 'english',
        duration: 2.5,
        text: 'Hello, this is a test transcription.',
        words: [
          { word: 'Hello', start: 0.0, end: 0.5 },
          { word: 'this', start: 0.5, end: 0.8 },
        ],
      }

      const AudioMock: any = openaiModule.Audio
      const TranscriptionsMock = AudioMock.Transcriptions
      TranscriptionsMock.prototype.create = jest.fn().mockResolvedValue(mockVerboseResponse)

      const mockFile = new Blob(['mock audio data'], { type: 'audio/mpeg' }) as any
      mockFile.name = 'test.mp3'

      const response = await client.audio.transcriptions.create({
        file: mockFile,
        model: 'whisper-1',
        response_format: 'verbose_json',
        posthogDistinctId: 'test-verbose-user',
      })

      expect(response).toEqual(mockVerboseResponse)
      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)

      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      expect(properties['$ai_output_choices']).toBe('Hello, this is a test transcription.')
      expect(properties['$ai_model_parameters']).toMatchObject({
        response_format: 'verbose_json',
      })
    })

    conditionalTest('transcription privacy mode', async () => {
      const mockFile = new Blob(['mock audio data'], { type: 'audio/mpeg' }) as any
      mockFile.name = 'test.mp3'

      await client.audio.transcriptions.create({
        file: mockFile,
        model: 'whisper-1',
        prompt: 'Sensitive prompt',
        posthogDistinctId: 'test-user',
        posthogPrivacyMode: true,
      })

      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      expect(properties['$ai_input']).toBeNull()
      expect(properties['$ai_output_choices']).toBeNull()
    })

    conditionalTest('transcription with usage tokens', async () => {
      const responseWithUsage = {
        text: 'Hello, this is a test transcription.',
        usage: {
          type: 'tokens' as const,
          input_tokens: 150,
          output_tokens: 50,
        },
      }

      const AudioMock: any = openaiModule.Audio
      const TranscriptionsMock = AudioMock.Transcriptions
      TranscriptionsMock.prototype.create = jest.fn().mockResolvedValue(responseWithUsage)

      const mockFile = new Blob(['mock audio data'], { type: 'audio/mpeg' }) as any
      mockFile.name = 'test.mp3'

      await client.audio.transcriptions.create({
        file: mockFile,
        model: 'whisper-1',
        posthogDistinctId: 'test-user',
      })

      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      expect(properties['$ai_input_tokens']).toBe(150)
      expect(properties['$ai_output_tokens']).toBe(50)
    })

    conditionalTest('transcription error handling', async () => {
      const AudioMock: any = openaiModule.Audio
      const TranscriptionsMock = AudioMock.Transcriptions
      const testError = new Error('API Error') as Error & { status: number }
      testError.status = 400
      TranscriptionsMock.prototype.create = jest.fn().mockRejectedValue(testError)

      const mockFile = new Blob(['mock audio data'], { type: 'audio/mpeg' }) as any
      mockFile.name = 'test.mp3'

      await expect(
        client.audio.transcriptions.create({
          file: mockFile,
          model: 'whisper-1',
          posthogDistinctId: 'error-user',
        })
      ).rejects.toThrow('API Error')

      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      expect(properties['$ai_http_status']).toBe(400)
      expect(properties['$ai_is_error']).toBe(true)
      expect(properties['$ai_error']).toContain('400')
    })

    conditionalTest('transcription captureImmediate flag', async () => {
      const mockFile = new Blob(['mock audio data'], { type: 'audio/mpeg' }) as any
      mockFile.name = 'test.mp3'

      await client.audio.transcriptions.create({
        file: mockFile,
        model: 'whisper-1',
        posthogDistinctId: 'test-user',
        posthogCaptureImmediate: true,
      })

      expect(mockPostHogClient.captureImmediate).toHaveBeenCalledTimes(1)
      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(0)
    })

    conditionalTest('transcription groups', async () => {
      const mockFile = new Blob(['mock audio data'], { type: 'audio/mpeg' }) as any
      mockFile.name = 'test.mp3'

      await client.audio.transcriptions.create({
        file: mockFile,
        model: 'whisper-1',
        posthogDistinctId: 'test-user',
        posthogGroups: { company: 'test_company' },
      })

      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { groups } = captureArgs[0]
      expect(groups).toEqual({ company: 'test_company' })
    })

    conditionalTest('posthogProperties are not sent to OpenAI', async () => {
      const AudioMock: any = openaiModule.Audio
      const TranscriptionsMock = AudioMock.Transcriptions
      const mockCreate = jest.fn().mockResolvedValue(mockTranscriptionResponse)
      const originalCreate = TranscriptionsMock.prototype.create
      TranscriptionsMock.prototype.create = mockCreate

      const mockFile = new Blob(['mock audio data'], { type: 'audio/mpeg' }) as any
      mockFile.name = 'test.mp3'

      await client.audio.transcriptions.create({
        file: mockFile,
        model: 'whisper-1',
        posthogDistinctId: 'test-user',
        posthogProperties: { key: 'value' },
        posthogGroups: { team: 'test' },
        posthogPrivacyMode: true,
        posthogCaptureImmediate: true,
        posthogTraceId: 'trace-123',
      })

      const [actualParams] = mockCreate.mock.calls[0]
      const posthogParams = Object.keys(actualParams).filter((key) => key.startsWith('posthog'))
      expect(posthogParams).toEqual([])
      TranscriptionsMock.prototype.create = originalCreate
    })
  })

  describe('Web Search Tracking', () => {
    conditionalTest('should track web search with Perplexity-style citations (binary detection)', async () => {
      mockOpenAiChatResponse = {
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: Date.now() / 1000,
        model: 'sonar-pro',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Based on my search, PostHog is a product analytics platform.',
              annotations: [
                {
                  type: 'url_citation',
                  text: 'PostHog docs',
                  url: 'https://posthog.com',
                },
              ] as any,
            },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 30,
          total_tokens: 80,
        },
      } as ChatCompletion

      await client.chat.completions.create({
        model: 'sonar-pro',
        messages: [{ role: 'user', content: 'What is PostHog?' }],
        posthogDistinctId: 'test-user',
      })

      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      expect(properties['$ai_web_search_count']).toBe(1)
    })

    conditionalTest('should track exact count from Responses API web_search_call', async () => {
      // Mock Responses API response with web_search_call items
      const mockResponsesResult = {
        id: 'resp_test',
        output: [
          {
            type: 'web_search_call',
            id: 'search_1',
            query: 'PostHog features',
          },
          {
            type: 'web_search_call',
            id: 'search_2',
            query: 'PostHog pricing',
          },
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: 'Based on the search results, here is what I found...',
              },
            ],
          },
        ],
        usage: {
          input_tokens: 60,
          output_tokens: 40,
          total_tokens: 100,
        },
      } as any

      const ResponsesMock: any = openaiModule.Responses || class MockResponses {}
      ResponsesMock.prototype.create = jest.fn().mockResolvedValue(mockResponsesResult)

      await client.responses.create({
        model: 'gpt-4',
        input: 'Tell me about PostHog',
        posthogDistinctId: 'test-user',
      } as any)

      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      // Should detect 2 web_search_call items (exact count)
      expect(properties['$ai_web_search_count']).toBe(2)
    })

    conditionalTest('should track web search in streaming with citations on final chunk', async () => {
      // Create stream chunks with citations
      mockStreamChunks = [
        {
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          created: Date.now() / 1000,
          model: 'sonar-pro',
          choices: [
            {
              index: 0,
              delta: { content: 'Search result text' },
              finish_reason: null,
              logprobs: null,
            },
          ],
        } as ChatCompletionChunk,
        {
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          created: Date.now() / 1000,
          model: 'sonar-pro',
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: 'stop',
              logprobs: null,
            },
          ],
          usage: {
            prompt_tokens: 40,
            completion_tokens: 25,
            total_tokens: 65,
          },
          citations: [
            {
              url: 'https://example.com',
              text: 'Example citation',
            },
          ] as any,
        } as any,
      ]

      const stream = await client.chat.completions.create({
        model: 'sonar-pro',
        messages: [{ role: 'user', content: 'Search query' }],
        stream: true,
        posthogDistinctId: 'test-user',
      })

      // Consume stream
      for await (const _chunk of stream) {
        // Just consume
      }

      await flushPromises()

      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      expect(properties['$ai_web_search_count']).toBe(1)
    })

    conditionalTest('should detect web search on early chunk without usage data (CRITICAL)', async () => {
      mockStreamChunks = [
        {
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          created: Date.now() / 1000,
          model: 'gpt-4',
          choices: [
            {
              index: 0,
              delta: {
                content: 'Search result',
                annotations: [
                  {
                    type: 'url_citation',
                    text: 'Citation',
                    url: 'https://example.com',
                  },
                ] as any,
              },
              finish_reason: null,
              logprobs: null,
            },
          ],
          // NO usage data on this chunk!
        } as any,
        {
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          created: Date.now() / 1000,
          model: 'gpt-4',
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: 'stop',
              logprobs: null,
            },
          ],
          usage: {
            prompt_tokens: 30,
            completion_tokens: 20,
            total_tokens: 50,
          },
        } as ChatCompletionChunk,
      ]

      const stream = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Query' }],
        stream: true,
        posthogDistinctId: 'test-user',
      })

      // Consume stream
      for await (const _chunk of stream) {
        // Just consume
      }

      await flushPromises()

      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      // Should detect web search from early chunk even without usage data
      expect(properties['$ai_web_search_count']).toBe(1)
    })

    conditionalTest('should detect web search from search_results (Perplexity via OpenRouter)', async () => {
      mockOpenAiChatResponse = {
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: Date.now() / 1000,
        model: 'sonar-pro',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Search result content',
            },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 35,
          completion_tokens: 28,
          total_tokens: 63,
        },
        search_results: [
          {
            url: 'https://example.com',
            title: 'Example',
          },
        ] as any,
      } as any

      await client.chat.completions.create({
        model: 'sonar-pro',
        messages: [{ role: 'user', content: 'Search' }],
        posthogDistinctId: 'test-user',
      })

      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      expect(properties['$ai_web_search_count']).toBe(1)
    })

    conditionalTest('should detect web search from search_context_size (Perplexity via OpenRouter)', async () => {
      mockOpenAiChatResponse = {
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: Date.now() / 1000,
        model: 'sonar-pro',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Search result',
            },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 45,
          completion_tokens: 32,
          total_tokens: 77,
          search_context_size: '1234',
        } as any,
      } as any

      await client.chat.completions.create({
        model: 'sonar-pro',
        messages: [{ role: 'user', content: 'Query' }],
        posthogDistinctId: 'test-user',
      })

      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      expect(properties['$ai_web_search_count']).toBe(1)
    })

    conditionalTest('should not include web search count when not present', async () => {
      mockOpenAiChatResponse = {
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: Date.now() / 1000,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Regular response without web search',
            },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 15,
          total_tokens: 35,
        },
      } as ChatCompletion

      await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        posthogDistinctId: 'test-user',
      })

      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      // Should not have web search count when not present
      expect(properties['$ai_web_search_count']).toBeUndefined()
    })
  })

  conditionalTest('posthogProperties are not sent to OpenAI', async () => {
    const ChatMock: any = openaiModule.Chat
    const mockCreate = jest.fn().mockResolvedValue({})
    const originalCreate = (ChatMock.Completions as any).prototype.create
    ;(ChatMock.Completions as any).prototype.create = mockCreate

    await client.chat.completions.create({
      model: 'gpt-4',
      messages: [],
      posthogDistinctId: 'test-id',
      posthogProperties: { key: 'value' },
      posthogGroups: { team: 'test' },
      posthogPrivacyMode: true,
      posthogCaptureImmediate: true,
      posthogTraceId: 'trace-123',
    })

    const [actualParams] = mockCreate.mock.calls[0]
    const posthogParams = Object.keys(actualParams).filter((key) => key.startsWith('posthog'))
    expect(posthogParams).toEqual([])
    ;(ChatMock.Completions as any).prototype.create = originalCreate
  })
})
