import { PostHog } from 'posthog-node'
import { PostHogAzureOpenAI } from '../src/openai/azure'
import openaiModule from 'openai'
import { Stream as OpenAIStream } from 'openai/streaming'
import { collectUnhandledRejections, flushPromises } from './test-utils'

let mockAzureEmbeddingResponse: any = {}

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

  // Mock AzureOpenAI class
  class MockAzureOpenAI {
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
    static Embeddings = MockEmbeddings
  }

  return {
    __esModule: true,
    default: MockAzureOpenAI,
    AzureOpenAI: MockAzureOpenAI,
    Chat: MockChat,
    Responses: MockResponses,
    Embeddings: MockEmbeddings,
  }
})

describe('PostHogAzureOpenAI - Embeddings test suite', () => {
  let mockPostHogClient: PostHog
  let client: PostHogAzureOpenAI

  beforeAll(() => {
    if (!process.env.AZURE_OPENAI_API_KEY) {
      console.warn('⚠️ Skipping Azure OpenAI tests: No AZURE_OPENAI_API_KEY environment variable set')
    }
  })

  beforeEach(() => {
    // Skip all tests if no API key is present
    if (!process.env.AZURE_OPENAI_API_KEY) {
      return
    }

    jest.clearAllMocks()

    // Reset the default mocks
    mockPostHogClient = new (PostHog as any)()
    client = new PostHogAzureOpenAI({
      apiKey: process.env.AZURE_OPENAI_API_KEY || '',
      posthog: mockPostHogClient as any,
    })

    // Default embeddings response
    mockAzureEmbeddingResponse = {
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

    // Mock the Embeddings class
    const EmbeddingsMock: any = openaiModule.Embeddings || class MockEmbeddings {}
    EmbeddingsMock.prototype.create = jest.fn().mockResolvedValue(mockAzureEmbeddingResponse)
  })

  // Conditionally run tests based on API key availability
  const conditionalTest = process.env.AZURE_OPENAI_API_KEY ? test : test.skip

  conditionalTest('basic completion', async () => {
    // Set up mock response for chat completions
    const mockAzureChatResponse = {
      id: 'chatcmpl-test-response-id',
      model: 'gpt-4',
      object: 'chat.completion',
      created: Date.now() / 1000,
      system_fingerprint: 'fp_test123',
      // `_request_id` is attached by the OpenAI SDK from the `x-request-id` header.
      _request_id: 'req_test-request-id',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'Hello from Azure OpenAI!',
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

    const ChatMock: any = openaiModule.Chat
    ;(ChatMock.Completions as any).prototype.create = jest.fn().mockResolvedValue(mockAzureChatResponse)

    const response = await client.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      posthogDistinctId: 'test-id',
      posthogProperties: { foo: 'bar' },
    })

    expect(response).toEqual(mockAzureChatResponse)
    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)

    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { distinctId, event, properties } = captureArgs[0]

    expect(distinctId).toBe('test-id')
    expect(event).toBe('$ai_generation')
    expect(properties['$ai_provider']).toBe('azure')
    expect(properties['$ai_model']).toBe('gpt-4')
    expect(properties['$ai_input']).toEqual([{ role: 'user', content: 'Hello' }])
    expect(properties['$ai_output_choices']).toEqual([
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Hello from Azure OpenAI!',
          },
        ],
      },
    ])
    expect(properties['$ai_input_tokens']).toBe(20)
    expect(properties['$ai_output_tokens']).toBe(10)
    expect(properties['$ai_http_status']).toBe(200)
    expect(properties['foo']).toBe('bar')
    expect(typeof properties['$ai_latency']).toBe('number')
    expect(properties['$ai_completion_id']).toBe('chatcmpl-test-response-id')
    expect(properties['$ai_provider_metadata']).toEqual({
      system_fingerprint: 'fp_test123',
      request_id: 'req_test-request-id',
    })
  })

  conditionalTest('responses create is wrapped and captures a generation', async () => {
    // Regression test for #2946: PostHogAzureOpenAI must wrap `responses` so that
    // responses.create(...) is tracked, like the non-Azure PostHogOpenAI client.
    const mockAzureResponsesResult = {
      id: 'resp_test-response-id',
      _request_id: 'req_test-responses-create',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello from Azure Responses!' }],
        },
      ],
      usage: {
        input_tokens: 20,
        output_tokens: 10,
        total_tokens: 30,
      },
    }

    const ResponsesMock: any = openaiModule.Responses
    ResponsesMock.prototype.create = jest.fn().mockResolvedValue(mockAzureResponsesResult)

    await client.responses.create({
      model: 'gpt-4',
      input: 'Hello',
      posthogDistinctId: 'test-id',
      posthogProperties: { foo: 'bar' },
    } as any)

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)

    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { distinctId, event, properties } = captureArgs[0]

    expect(distinctId).toBe('test-id')
    expect(event).toBe('$ai_generation')
    expect(properties['$ai_provider']).toBe('azure')
    expect(properties['$ai_model']).toBe('gpt-4')
    expect(properties['$ai_completion_id']).toBe('resp_test-response-id')
    expect(properties['$ai_input']).toEqual([{ role: 'user', content: 'Hello' }])
    expect(properties['$ai_output_choices']).toEqual(mockAzureResponsesResult.output)
    expect(properties['$ai_input_tokens']).toBe(20)
    expect(properties['$ai_output_tokens']).toBe(10)
    expect(properties['$ai_http_status']).toBe(200)
    expect(typeof properties['$ai_latency']).toBe('number')
    expect(properties['foo']).toBe('bar')
  })

  conditionalTest('redacts chat and Responses input/output without changing Azure payloads', async () => {
    const binary = 'A'.repeat(80)
    const chatResponse = {
      id: 'chatcmpl-binary',
      model: 'gpt-4o-audio-preview',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: null,
            audio: { id: 'audio-1', data: binary, transcript: 'hello', expires_at: 0 },
          },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }
    const ChatMock: any = openaiModule.Chat
    ;(ChatMock.Completions as any).prototype.create = jest.fn().mockResolvedValue(chatResponse)
    const chatRequest = {
      model: 'gpt-4o-audio-preview',
      messages: [
        {
          role: 'user' as const,
          content: [{ type: 'input_audio' as const, input_audio: { data: binary, format: 'wav' as const } }],
        },
      ],
    }

    await client.chat.completions.create(chatRequest)

    expect((ChatMock.Completions as any).prototype.create).toHaveBeenCalledWith(chatRequest, undefined)
    const chatProperties = (mockPostHogClient.capture as jest.Mock).mock.calls[0][0].properties
    expect(JSON.stringify(chatProperties['$ai_input'])).not.toContain(binary)
    expect(JSON.stringify(chatProperties['$ai_output_choices'])).not.toContain(binary)
    expect(JSON.stringify(chatProperties)).toContain('[base64 audio/wav redacted]')
    expect(JSON.stringify(chatProperties)).toContain('[base64 audio redacted]')

    jest.clearAllMocks()
    const responsesResult = {
      id: 'resp-binary',
      model: 'gpt-4o',
      output: [{ type: 'image_generation_call', id: 'image-1', status: 'completed', result: binary }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }
    const ResponsesMock: any = openaiModule.Responses
    ResponsesMock.prototype.create = jest.fn().mockResolvedValue(responsesResult)
    const responsesRequest = {
      model: 'gpt-4o',
      input: [
        {
          role: 'user' as const,
          content: [{ type: 'input_image' as const, image_url: `data:image/png;base64,${binary}` }],
        },
      ],
    }

    const response = await client.responses.create(responsesRequest as any)

    expect(response.output[0]).toMatchObject({ result: binary })
    expect(ResponsesMock.prototype.create).toHaveBeenCalledWith(responsesRequest, undefined)
    const responsesProperties = (mockPostHogClient.capture as jest.Mock).mock.calls[0][0].properties
    expect(JSON.stringify(responsesProperties['$ai_input'])).not.toContain(binary)
    expect(JSON.stringify(responsesProperties['$ai_output_choices'])).not.toContain(binary)
    expect(JSON.stringify(responsesProperties)).toContain('[base64 image/png redacted]')
    expect(JSON.stringify(responsesProperties)).toContain('[base64 redacted]')
  })

  conditionalTest('groups', async () => {
    const mockAzureChatResponse = {
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
            content: 'Hello!',
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

    const ChatMock: any = openaiModule.Chat
    ;(ChatMock.Completions as any).prototype.create = jest.fn().mockResolvedValue(mockAzureChatResponse)

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
    const mockAzureChatResponse = {
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
            content: 'Hello!',
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

    const ChatMock: any = openaiModule.Chat
    ;(ChatMock.Completions as any).prototype.create = jest.fn().mockResolvedValue(mockAzureChatResponse)

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

    const mockAzureChatResponse = {
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
            content: 'Hello!',
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

    const ChatMock: any = openaiModule.Chat
    ;(ChatMock.Completions as any).prototype.create = jest.fn().mockResolvedValue(mockAzureChatResponse)

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

  conditionalTest('captureImmediate flag', async () => {
    const mockAzureChatResponse = {
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
            content: 'Hello!',
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

    const ChatMock: any = openaiModule.Chat
    ;(ChatMock.Completions as any).prototype.create = jest.fn().mockResolvedValue(mockAzureChatResponse)

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

  conditionalTest('anonymous user - $process_person_profile set to false', async () => {
    const mockAzureChatResponse = {
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
            content: 'Hello!',
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

    const ChatMock: any = openaiModule.Chat
    ;(ChatMock.Completions as any).prototype.create = jest.fn().mockResolvedValue(mockAzureChatResponse)

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
    const mockAzureChatResponse = {
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
            content: 'Hello!',
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

    const ChatMock: any = openaiModule.Chat
    ;(ChatMock.Completions as any).prototype.create = jest.fn().mockResolvedValue(mockAzureChatResponse)

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

  conditionalTest('system prompt handling', async () => {
    const mockAzureChatResponse = {
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
            content: 'Paris is the capital of France.',
            refusal: null,
          },
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: 25,
        completion_tokens: 8,
        total_tokens: 33,
      },
    }

    const ChatMock: any = openaiModule.Chat
    ;(ChatMock.Completions as any).prototype.create = jest.fn().mockResolvedValue(mockAzureChatResponse)

    await client.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are a helpful geography assistant.' },
        { role: 'user', content: 'What is the capital of France?' },
      ],
      posthogDistinctId: 'test-system-prompt',
    })

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { distinctId, properties } = captureArgs[0]

    expect(distinctId).toBe('test-system-prompt')
    expect(properties['$ai_input']).toEqual([
      { role: 'system', content: 'You are a helpful geography assistant.' },
      { role: 'user', content: 'What is the capital of France?' },
    ])
    expect(properties['$ai_provider']).toBe('azure')
    expect(properties['$ai_model']).toBe('gpt-4')
  })

  describe('Embeddings', () => {
    conditionalTest('basic embeddings', async () => {
      const response = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: 'Hello world',
        posthogDistinctId: 'test-id',
        posthogProperties: { test: 'embeddings' },
      })

      expect(response).toEqual(mockAzureEmbeddingResponse)
      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)

      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { distinctId, event, properties } = captureArgs[0]

      expect(distinctId).toBe('test-id')
      expect(event).toBe('$ai_embedding')
      expect(properties['$ai_provider']).toBe('azure')
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
      mockAzureEmbeddingResponse = {
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
      EmbeddingsMock.prototype.create = jest.fn().mockResolvedValue(mockAzureEmbeddingResponse)

      const response = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: arrayInput,
        posthogDistinctId: 'test-array-id',
      })

      expect(response).toEqual(mockAzureEmbeddingResponse)
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

    conditionalTest('embeddings with default trace ID', async () => {
      await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: 'Test input',
        posthogDistinctId: 'test-id',
      })

      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      // Should have a generated trace ID
      expect(typeof properties['$ai_trace_id']).toBe('string')
      expect(properties['$ai_trace_id']).toHaveLength(36) // UUID v4 length
    })

    conditionalTest('embeddings with custom trace ID', async () => {
      const customTraceId = 'custom-trace-123'

      await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: 'Test input',
        posthogDistinctId: 'test-id',
        posthogTraceId: customTraceId,
      })

      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      expect(properties['$ai_trace_id']).toBe(customTraceId)
    })

    conditionalTest('embeddings with groups', async () => {
      const testGroups = { company: 'acme', team: 'engineering' }

      await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: 'Test input',
        posthogDistinctId: 'test-id',
        posthogGroups: testGroups,
      })

      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { groups } = captureArgs[0]

      expect(groups).toEqual(testGroups)
    })
  })

  conditionalTest('posthogProperties are not sent to Azure OpenAI', async () => {
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

describe('PostHogAzureOpenAI - streaming error safety', () => {
  let safetyMockPostHogClient: PostHog
  let safetyClient: PostHogAzureOpenAI

  beforeEach(() => {
    jest.clearAllMocks()
    safetyMockPostHogClient = new (PostHog as any)()
    safetyClient = new PostHogAzureOpenAI({
      apiKey: 'test-api-key',
      posthog: safetyMockPostHogClient as any,
    } as any)
  })

  test('break after first chunk cancels the real Azure OpenAI stream and captures only partial output', async () => {
    const sourceController = new AbortController()
    let pulls = 0
    let sourceReturned = false
    const firstChunk = {
      id: 'chatcmpl-azure-partial',
      model: 'gpt-4',
      object: 'chat.completion.chunk',
      created: 1,
      choices: [{ index: 0, delta: { content: 'partial' }, finish_reason: null, logprobs: null }],
    }
    const source = new OpenAIStream<any>(() => {
      const iterator = (async function* () {
        try {
          pulls += 1
          yield firstChunk
          pulls += 1
          yield { ...firstChunk, choices: [{ ...firstChunk.choices[0], delta: { content: 'unobserved' } }] }
        } finally {
          sourceReturned = true
          sourceController.abort()
        }
      })()
      return iterator
    }, sourceController)

    ;((openaiModule as any).Chat.Completions as any).prototype.create = jest.fn().mockResolvedValue(source)
    const stream = await safetyClient.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Stop early' }],
      stream: true,
      posthogDistinctId: 'azure-break-user',
    } as any)

    expect(stream).toBeInstanceOf(OpenAIStream)
    expect(pulls).toBe(0)
    for await (const _chunk of stream as unknown as AsyncIterable<unknown>) {
      break
    }
    await flushPromises()

    expect(pulls).toBe(1)
    expect(sourceReturned).toBe(true)
    expect(sourceController.signal.aborted).toBe(true)
    expect(safetyMockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const properties = (safetyMockPostHogClient.capture as jest.Mock).mock.calls[0][0].properties
    expect(properties['$ai_output_choices'][0].content[0].text).toBe('partial')
  })

  const streamErrorCases: {
    name: string
    firstChunk: unknown
    stubCreate: (impl: jest.Mock) => void
    invoke: () => Promise<unknown>
  }[] = [
    {
      name: 'chat completions',
      firstChunk: {
        id: 'chatcmpl-test',
        model: 'gpt-4',
        object: 'chat.completion.chunk',
        created: 1,
        choices: [{ index: 0, delta: { content: 'partial' }, finish_reason: null, logprobs: null }],
      },
      stubCreate: (impl) => {
        ;((openaiModule as any).Chat.Completions as any).prototype.create = impl
      },
      invoke: () =>
        safetyClient.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Tell me about streaming' }],
          stream: true,
          posthogDistinctId: 'test-stream-error-user',
        } as any),
    },
    {
      name: 'responses',
      firstChunk: { type: 'response.output_text.delta', delta: 'partial' },
      stubCreate: (impl) => {
        ;((openaiModule as any).Responses as any).prototype.create = impl
      },
      invoke: () =>
        safetyClient.responses.create({
          model: 'gpt-4',
          input: 'Tell me about streaming',
          stream: true,
          posthogDistinctId: 'test-stream-error-user',
        } as any),
    },
  ]

  test.each(streamErrorCases)('$name stream error is not rethrown unhandled', async (streamErrorCase) => {
    const streamError = new Error('provider error injected into SSE stream')
    const createErroringIterator = (): { [Symbol.asyncIterator](): AsyncIterator<unknown> } => ({
      async *[Symbol.asyncIterator]() {
        yield streamErrorCase.firstChunk
        throw streamError
      },
    })

    streamErrorCase.stubCreate(jest.fn().mockImplementation(() => Promise.resolve(createErroringIterator())))

    const unhandledRejections = await collectUnhandledRejections(async () => {
      const stream = await streamErrorCase.invoke()

      // The caller's copy of the stream must still surface the error
      await expect(async () => {
        for await (const _chunk of stream as AsyncIterable<unknown>) {
          // consume until the error
        }
      }).rejects.toThrow(streamError)
    })

    // The analytics error event is still captured
    expect(safetyMockPostHogClient.capture).toHaveBeenCalledTimes(1)

    // The detached analytics consumer must not crash the host process
    expect(unhandledRejections).toEqual([])
  })
})

describe('PostHogAzureOpenAI - cache token reporting convention', () => {
  // Deliberately not `conditionalTest`: azure.ts routes captures through the
  // OpenAI capture helper, and with the credential-gated suite above skipped
  // in CI (no AZURE_OPENAI_API_KEY), a gated test would never catch the Azure
  // path bypassing the declaration. Everything here is mocked.
  test.each([
    { behavior: 'declares inclusive reporting by default', posthogProperties: undefined, expectedFlag: false },
    {
      behavior: 'lets user-provided posthogProperties override the declaration',
      posthogProperties: { $ai_cache_reporting_exclusive: true },
      expectedFlag: true,
    },
  ])('$behavior', async ({ posthogProperties, expectedFlag }) => {
    const mockPostHogClient = new (PostHog as any)()
    const client = new PostHogAzureOpenAI({
      apiKey: 'mock-azure-key',
      posthog: mockPostHogClient as any,
    })

    const ChatMock: any = openaiModule.Chat
    const originalCreate = (ChatMock.Completions as any).prototype.create
    ;(ChatMock.Completions as any).prototype.create = jest.fn().mockResolvedValue({
      id: 'chatcmpl-cache-convention',
      model: 'gpt-4',
      object: 'chat.completion',
      created: 1234567890,
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'Hello!',
            refusal: null,
          },
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: 32611,
        completion_tokens: 561,
        total_tokens: 33172,
        prompt_tokens_details: {
          cached_tokens: 27929,
        },
      },
    })

    await client.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      posthogDistinctId: 'test-id',
      posthogProperties,
    })

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { properties } = captureArgs[0]

    expect(properties['$ai_provider']).toBe('azure')
    expect(properties['$ai_input_tokens']).toBe(32611)
    expect(properties['$ai_cache_read_input_tokens']).toBe(27929)
    expect(properties['$ai_cache_reporting_exclusive']).toBe(expectedFlag)
    ;(ChatMock.Completions as any).prototype.create = originalCreate
  })

  test('captures cache creation tokens for chat completions', async () => {
    const mockPostHogClient = new (PostHog as any)()
    const client = new PostHogAzureOpenAI({
      apiKey: 'mock-azure-key',
      posthog: mockPostHogClient as any,
    })

    const ChatMock: any = openaiModule.Chat
    const originalCreate = (ChatMock.Completions as any).prototype.create
    ;(ChatMock.Completions as any).prototype.create = jest.fn().mockResolvedValue({
      id: 'chatcmpl-cache-write',
      model: 'gpt-4',
      object: 'chat.completion',
      created: 1234567890,
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'Hello!', refusal: null },
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: 33400,
        completion_tokens: 572,
        total_tokens: 33972,
        prompt_tokens_details: { cached_tokens: 29580, cache_write_tokens: 3820 },
      },
    })

    await client.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      posthogDistinctId: 'test-id',
    })

    const { properties } = (mockPostHogClient.capture as jest.Mock).mock.calls[0][0]
    expect(properties['$ai_cache_read_input_tokens']).toBe(29580)
    expect(properties['$ai_cache_creation_input_tokens']).toBe(3820)
    ;(ChatMock.Completions as any).prototype.create = originalCreate
  })

  test('captures cache creation tokens for responses create', async () => {
    const mockPostHogClient = new (PostHog as any)()
    const client = new PostHogAzureOpenAI({
      apiKey: 'mock-azure-key',
      posthog: mockPostHogClient as any,
    })

    const ResponsesMock: any = openaiModule.Responses
    const originalCreate = ResponsesMock.prototype.create
    ResponsesMock.prototype.create = jest.fn().mockResolvedValue({
      id: 'resp-cache-write',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] }],
      usage: {
        input_tokens: 33400,
        output_tokens: 572,
        total_tokens: 33972,
        input_tokens_details: { cached_tokens: 29580, cache_write_tokens: 3820 },
      },
    })

    await client.responses.create({ model: 'gpt-4', input: 'Hello', posthogDistinctId: 'test-id' } as any)

    const { properties } = (mockPostHogClient.capture as jest.Mock).mock.calls[0][0]
    expect(properties['$ai_cache_read_input_tokens']).toBe(29580)
    expect(properties['$ai_cache_creation_input_tokens']).toBe(3820)
    ResponsesMock.prototype.create = originalCreate
  })
})

describe('PostHogAzureOpenAI - Responses terminal statuses', () => {
  let mockPostHogClient: PostHog
  let client: PostHogAzureOpenAI

  const terminalStatuses = ['completed', 'failed', 'incomplete', 'cancelled'] as const

  const createMockAsyncIterator = <T>(chunks: T[]): { [Symbol.asyncIterator](): AsyncIterator<T> } => ({
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk
      }
    },
  })

  const terminalResponse = (status: (typeof terminalStatuses)[number]) => ({
    id: `resp_${status}`,
    _request_id: `req_${status}`,
    model: 'gpt-4',
    object: 'response',
    created_at: 1234567890,
    status,
    output: [
      {
        id: `msg_${status}`,
        type: 'message',
        role: 'assistant',
        status: status === 'completed' ? 'completed' : 'incomplete',
        content: [{ type: 'output_text', text: `${status} output`, annotations: [] }],
      },
    ],
    usage: {
      input_tokens: 11,
      output_tokens: 7,
      total_tokens: 18,
      input_tokens_details: { cached_tokens: 2 },
      output_tokens_details: { reasoning_tokens: 3 },
    },
    service_tier: 'default',
    error: status === 'failed' ? { code: 'server_error', message: 'provider response failed' } : null,
    incomplete_details: status === 'incomplete' || status === 'cancelled' ? { reason: 'max_output_tokens' } : null,
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockPostHogClient = new (PostHog as any)()
    client = new PostHogAzureOpenAI({
      apiKey: 'mock-azure-key',
      posthog: mockPostHogClient as any,
    })
  })

  test.each(terminalStatuses)('non-streaming %s response preserves terminal data', async (status) => {
    const response = terminalResponse(status)
    const ResponsesMock: any = openaiModule.Responses
    ResponsesMock.prototype.create = jest.fn().mockResolvedValue(response)

    await client.responses.create({
      model: 'gpt-4',
      input: 'Hello',
      posthogDistinctId: 'test-id',
    })

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const properties = (mockPostHogClient.capture as jest.Mock).mock.calls[0][0].properties
    expect(properties['$ai_stop_reason']).toBe(status)
    expect(properties['$ai_input_tokens']).toBe(11)
    expect(properties['$ai_output_tokens']).toBe(7)
    expect(properties['$ai_output_choices']).toEqual(response.output)
    expect(properties['$ai_is_error']).toBe(status === 'failed' ? true : undefined)
    if (status === 'failed') {
      expect(properties['$ai_error']).toContain('provider response failed')
    }
    expect(properties['$ai_provider_metadata']).toEqual({
      request_id: `req_${status}`,
      ...(status === 'incomplete' || status === 'cancelled'
        ? { incomplete_details: { reason: 'max_output_tokens' } }
        : {}),
    })
  })

  test.each(terminalStatuses)('streaming %s response preserves terminal data', async (status) => {
    const baseResponse = terminalResponse(status)
    const response = { ...baseResponse, output: status === 'cancelled' ? undefined : baseResponse.output }
    const terminalEventType =
      status === 'failed' ? 'response.failed' : status === 'completed' ? 'response.completed' : 'response.incomplete'
    const chunks = [{ type: terminalEventType, sequence_number: 0, response }]
    const ResponsesMock: any = openaiModule.Responses
    ResponsesMock.prototype.create = jest.fn().mockResolvedValue(createMockAsyncIterator(chunks))

    const stream = await client.responses.create({
      model: 'gpt-4',
      input: 'Hello',
      stream: true,
      posthogDistinctId: 'test-id',
    })
    for await (const _chunk of stream) {
      // consume the returned stream while analytics consumes its monitored copy
    }
    await flushPromises()

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const properties = (mockPostHogClient.capture as jest.Mock).mock.calls[0][0].properties
    expect(properties['$ai_stop_reason']).toBe(status)
    expect(properties['$ai_input_tokens']).toBe(11)
    expect(properties['$ai_output_tokens']).toBe(7)
    expect(properties['$ai_output_choices']).toEqual(response.output ?? [])
    expect(properties['$ai_is_error']).toBe(status === 'failed' ? true : undefined)
    if (status === 'failed') {
      expect(properties['$ai_error']).toContain('provider response failed')
    }
    expect(properties['$ai_provider_metadata']).toEqual(
      status === 'incomplete' || status === 'cancelled'
        ? { incomplete_details: { reason: 'max_output_tokens' } }
        : undefined
    )
  })

  test('parse failed response preserves terminal data', async () => {
    const response = terminalResponse('failed')
    const ResponsesMock: any = openaiModule.Responses
    ResponsesMock.prototype.parse = jest.fn().mockResolvedValue(response)

    await client.responses.parse({
      model: 'gpt-4',
      input: 'Hello',
      posthogDistinctId: 'test-id',
    } as any)

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const properties = (mockPostHogClient.capture as jest.Mock).mock.calls[0][0].properties
    expect(properties['$ai_stop_reason']).toBe('failed')
    expect(properties['$ai_is_error']).toBe(true)
    expect(properties['$ai_error']).toContain('provider response failed')
    expect(properties['$ai_provider_metadata']).toEqual({ request_id: 'req_failed' })
  })
})

describe('PostHogAzureOpenAI - response service tier', () => {
  let mockPostHogClient: PostHog
  let client: PostHogAzureOpenAI

  const createMockAsyncIterator = <T>(chunks: T[]): { [Symbol.asyncIterator](): AsyncIterator<T> } => ({
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk
      }
    },
  })

  const responsesUsage = {
    input_tokens: 20,
    output_tokens: 10,
    total_tokens: 30,
    input_tokens_details: { cached_tokens: 4 },
    output_tokens_details: { reasoning_tokens: 3 },
  }

  const mockResponsesResult = (serviceTier: 'default' | 'flex') => ({
    id: 'resp-service-tier',
    model: 'gpt-4',
    object: 'response',
    created_at: 1234567890,
    status: 'completed',
    output: [],
    usage: responsesUsage,
    service_tier: serviceTier,
  })

  const capturedServiceTier = (): string => {
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    return captureArgs[0].properties['$ai_model_parameters'].service_tier
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockPostHogClient = new (PostHog as any)()
    client = new PostHogAzureOpenAI({
      apiKey: 'mock-azure-key',
      posthog: mockPostHogClient as any,
    })
  })

  test('prefers the response tier for non-streaming chat completions', async () => {
    const ChatMock: any = openaiModule.Chat
    ;(ChatMock.Completions as any).prototype.create = jest.fn().mockResolvedValue({
      id: 'chatcmpl-service-tier',
      model: 'gpt-4',
      object: 'chat.completion',
      created: 1234567890,
      choices: [],
      service_tier: 'flex',
    })

    await client.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      service_tier: 'auto',
      posthogDistinctId: 'test-id',
    })

    expect(capturedServiceTier()).toBe('flex')
  })

  test('prefers the final response tier for streaming chat completions', async () => {
    const chunks = [
      {
        id: 'chatcmpl-service-tier',
        model: 'gpt-4',
        object: 'chat.completion.chunk',
        created: 1234567890,
        choices: [],
        service_tier: 'default',
      },
      {
        id: 'chatcmpl-service-tier',
        model: 'gpt-4',
        object: 'chat.completion.chunk',
        created: 1234567890,
        choices: [],
        service_tier: 'flex',
      },
    ]
    const ChatMock: any = openaiModule.Chat
    ;(ChatMock.Completions as any).prototype.create = jest.fn().mockResolvedValue(createMockAsyncIterator(chunks))

    const stream = await client.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      service_tier: 'auto',
      stream: true,
      posthogDistinctId: 'test-id',
    })
    for await (const _chunk of stream) {
      // consume the stream so the analytics copy reaches the final chunk
    }
    await flushPromises()

    expect(capturedServiceTier()).toBe('flex')
  })

  test.each([
    {
      api: 'responses.create',
      method: 'create',
      invoke: () =>
        client.responses.create({
          model: 'gpt-4',
          input: 'Hello',
          service_tier: 'auto',
          posthogDistinctId: 'test-id',
        }),
    },
    {
      api: 'responses.parse',
      method: 'parse',
      invoke: () =>
        client.responses.parse({
          model: 'gpt-4',
          input: 'Hello',
          service_tier: 'auto',
          posthogDistinctId: 'test-id',
        } as any),
    },
  ])('prefers the response tier for non-streaming $api', async ({ method, invoke }) => {
    const ResponsesMock: any = openaiModule.Responses
    ResponsesMock.prototype[method] = jest.fn().mockResolvedValue(mockResponsesResult('flex'))

    await invoke()

    expect(capturedServiceTier()).toBe('flex')
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureArgs[0].properties).toMatchObject({
      $ai_usage: responsesUsage,
      $ai_stop_reason: 'completed',
    })
  })

  test('prefers the final response tier for streaming responses', async () => {
    const chunks = [
      { type: 'response.created', response: mockResponsesResult('default') },
      { type: 'response.completed', response: mockResponsesResult('flex') },
    ]
    const ResponsesMock: any = openaiModule.Responses
    ResponsesMock.prototype.create = jest.fn().mockResolvedValue(createMockAsyncIterator(chunks))

    const stream = await client.responses.create({
      model: 'gpt-4',
      input: 'Hello',
      service_tier: 'auto',
      stream: true,
      posthogDistinctId: 'test-id',
    })
    for await (const _chunk of stream) {
      // consume the stream so the analytics copy reaches the final chunk
    }
    await flushPromises()

    expect(capturedServiceTier()).toBe('flex')
  })

  test('captures usage from the final streaming response', async () => {
    const completedResponse = {
      ...mockResponsesResult('default'),
      usage: {
        input_tokens: 20,
        output_tokens: 10,
        total_tokens: 30,
        input_tokens_details: { cached_tokens: 4 },
        output_tokens_details: { reasoning_tokens: 3 },
      },
    }
    const ResponsesMock: any = openaiModule.Responses
    ResponsesMock.prototype.create = jest
      .fn()
      .mockResolvedValue(createMockAsyncIterator([{ type: 'response.completed', response: completedResponse }]))

    const stream = await client.responses.create({
      model: 'gpt-4',
      input: 'Hello',
      stream: true,
      posthogDistinctId: 'test-id',
    })
    for await (const _chunk of stream) {
      // consume the stream so the analytics copy reaches the final chunk
    }
    await flushPromises()

    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const properties = captureArgs[0].properties
    expect(properties['$ai_input_tokens']).toBe(20)
    expect(properties['$ai_output_tokens']).toBe(10)
    expect(properties['$ai_reasoning_tokens']).toBe(3)
    expect(properties['$ai_cache_read_input_tokens']).toBe(4)
  })
})
