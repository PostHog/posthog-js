import { PostHog } from 'posthog-node'
import PostHogOpenAI from '../src/openai'
import openaiModule from 'openai'

let mockOpenAiChatResponse: any = {}
let mockOpenAiParsedResponse: any = {}

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

  // Mock Responses class
  class MockResponses {
    constructor() {}
    create = jest.fn()
  }

  // Add parse to prototype instead of instance
  ;(MockResponses.prototype as any).parse = jest.fn()

  // Mock OpenAI class
  class MockOpenAI {
    chat: any
    embeddings: any
    responses: any
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
    }
    static Chat = MockChat
    static Responses = MockResponses
  }

  return {
    __esModule: true,
    default: MockOpenAI,
    OpenAI: MockOpenAI,
    Chat: MockChat,
    Responses: MockResponses,
  }
})

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

    // Some default chat completion mock
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
          },
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
          type: 'output_text',
          text: '{"name": "Science Fair", "date": "Friday", "participants": ["Alice", "Bob"]}',
        },
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
    }

    const ChatMock: any = openaiModule.Chat
    ;(ChatMock.Completions as any).prototype.create = jest.fn().mockResolvedValue(mockOpenAiChatResponse)

    // Mock responses.parse using the same pattern as chat completions
    const ResponsesMock: any = openaiModule.Responses
    ResponsesMock.prototype.parse.mockResolvedValue(mockOpenAiParsedResponse)
  })

  // Wrap each test with conditional skip
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
    expect(properties['$ai_provider']).toBe('openai')
    expect(properties['$ai_model']).toBe('gpt-4')
    expect(properties['$ai_input']).toEqual([{ role: 'user', content: 'Hello' }])
    expect(properties['$ai_output_choices']).toEqual([{ role: 'assistant', content: 'Hello from OpenAI!' }])
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
})
