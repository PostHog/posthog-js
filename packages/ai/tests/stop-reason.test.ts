import { PostHog } from 'posthog-node'
import PostHogOpenAI from '../src/openai'
import PostHogAnthropic from '../src/anthropic'
import PostHogGemini from '../src/gemini'
import { LangChainCallbackHandler } from '../src/langchain/callbacks'
import { withTracing } from '../src/index'
import { flushPromises } from './test-utils'
import openaiModule from 'openai'
import AnthropicOriginal from '@anthropic-ai/sdk'
import { AIMessage } from '@langchain/core/messages'
import type { ChatCompletion, ChatCompletionChunk } from 'openai/resources/chat/completions'
import type {
  LanguageModelV2,
  LanguageModelV2StreamPart,
  LanguageModelV3,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider'

// --- Mocks ---

jest.mock('posthog-node', () => ({
  PostHog: jest.fn().mockImplementation(() => ({
    capture: jest.fn(),
    captureImmediate: jest.fn(),
    privacy_mode: false,
  })),
}))

jest.mock('openai', () => {
  class MockCompletions {
    create(..._args: any[]): any {
      return undefined
    }
  }
  class MockChat {
    constructor() {}
    static Completions = MockCompletions
  }
  class MockResponses {
    constructor() {}
    create() {
      return Promise.resolve({})
    }
    parse() {
      return Promise.resolve({})
    }
  }
  class MockEmbeddings {
    constructor() {}
    create() {
      return Promise.resolve({})
    }
  }
  class MockTranscriptions {
    constructor() {}
    create() {
      return Promise.resolve({})
    }
  }
  class MockAudio {
    constructor() {}
    static Transcriptions = MockTranscriptions
  }
  class MockOpenAI {
    chat: any
    embeddings: any
    responses: any
    audio: any
    constructor() {
      this.chat = { completions: { create: jest.fn() } }
      this.embeddings = { create: jest.fn() }
      this.responses = { create: jest.fn() }
      this.audio = { transcriptions: { create: jest.fn() } }
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
    AzureOpenAI: MockOpenAI,
    Chat: MockChat,
    Responses: MockResponses,
    Embeddings: MockEmbeddings,
    Audio: MockAudio,
  }
})

jest.mock('@anthropic-ai/sdk', () => {
  class MockMessages {
    create(..._args: any[]): any {
      return undefined
    }
  }
  class MockAnthropic {
    messages: any
    constructor() {
      this.messages = new MockMessages()
    }
    static Messages = MockMessages
  }
  return { __esModule: true, default: MockAnthropic }
})

jest.mock('@google/genai', () => {
  class MockGoogleGenAI {
    models: any
    constructor() {
      this.models = {
        generateContent: jest.fn(),
        generateContentStream: jest.fn(),
      }
    }
  }
  return { GoogleGenAI: MockGoogleGenAI }
})

// --- Helpers ---

interface MockAsyncIterator<T> {
  [Symbol.asyncIterator](): AsyncIterator<T>
}

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

const getCapturedProperties = (client: PostHog): Record<string, any> => {
  const captureMock = client.capture as jest.Mock
  expect(captureMock).toHaveBeenCalledTimes(1)
  return captureMock.mock.calls[0][0].properties
}

// --- Tests ---

describe('$ai_stop_reason extraction', () => {
  let mockPostHogClient: PostHog

  beforeEach(() => {
    jest.clearAllMocks()
    mockPostHogClient = new (PostHog as any)()
  })

  describe('OpenAI Chat Completions', () => {
    let client: PostHogOpenAI

    beforeEach(() => {
      client = new PostHogOpenAI({
        apiKey: 'test-key',
        posthog: mockPostHogClient as any,
      })
    })

    test('non-streaming: extracts finish_reason', async () => {
      const mockResponse: ChatCompletion = {
        id: 'test-id',
        model: 'gpt-4',
        object: 'chat.completion',
        created: Date.now() / 1000,
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'Hello!', refusal: null },
            logprobs: null,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }

      const ChatMock: any = openaiModule.Chat
      ;(ChatMock.Completions as any).prototype.create = jest.fn().mockResolvedValue(mockResponse)

      await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        posthogDistinctId: 'test-user',
      })

      const properties = getCapturedProperties(mockPostHogClient)
      expect(properties['$ai_stop_reason']).toBe('stop')
    })

    test('non-streaming: extracts length finish_reason', async () => {
      const mockResponse: ChatCompletion = {
        id: 'test-id',
        model: 'gpt-4',
        object: 'chat.completion',
        created: Date.now() / 1000,
        choices: [
          {
            index: 0,
            finish_reason: 'length',
            message: { role: 'assistant', content: 'Truncated...', refusal: null },
            logprobs: null,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 100, total_tokens: 110 },
      }

      const ChatMock: any = openaiModule.Chat
      ;(ChatMock.Completions as any).prototype.create = jest.fn().mockResolvedValue(mockResponse)

      await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Write a long essay' }],
        posthogDistinctId: 'test-user',
      })

      const properties = getCapturedProperties(mockPostHogClient)
      expect(properties['$ai_stop_reason']).toBe('length')
    })

    test('streaming: extracts finish_reason from final chunk', async () => {
      const chunks: ChatCompletionChunk[] = [
        {
          id: 'test',
          model: 'gpt-4',
          object: 'chat.completion.chunk',
          created: Date.now() / 1000,
          choices: [{ index: 0, delta: { content: 'Hello!' }, finish_reason: null, logprobs: null }],
        },
        {
          id: 'test',
          model: 'gpt-4',
          object: 'chat.completion.chunk',
          created: Date.now() / 1000,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop', logprobs: null }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
      ]

      const ChatMock: any = openaiModule.Chat
      ;(ChatMock.Completions as any).prototype.create = jest.fn().mockImplementation(() => {
        const mockStream = {
          tee: jest.fn().mockReturnValue([createMockAsyncIterator(chunks), createMockAsyncIterator(chunks)]),
        }
        return Promise.resolve(mockStream)
      })

      const stream = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
        posthogDistinctId: 'test-user',
      })

      // Consume the stream
      for await (const _chunk of stream as any) {
        // consume
      }

      await flushPromises()

      const properties = getCapturedProperties(mockPostHogClient)
      expect(properties['$ai_stop_reason']).toBe('stop')
    })
  })

  describe('OpenAI Responses API', () => {
    let client: PostHogOpenAI

    beforeEach(() => {
      client = new PostHogOpenAI({
        apiKey: 'test-key',
        posthog: mockPostHogClient as any,
      })
    })

    test('non-streaming: extracts status as stop reason', async () => {
      const mockResponse = {
        id: 'resp-test',
        model: 'gpt-4o',
        object: 'response',
        status: 'completed',
        output: [
          {
            id: 'msg-001',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Hello!' }],
          },
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 15,
        },
      }

      const ResponsesMock: any = openaiModule.Responses
      ResponsesMock.prototype.create = jest.fn().mockResolvedValue(mockResponse)

      await client.responses.create({
        model: 'gpt-4o',
        input: 'Hi',
        posthogDistinctId: 'test-user',
      })

      const properties = getCapturedProperties(mockPostHogClient)
      expect(properties['$ai_stop_reason']).toBe('completed')
    })

    test('streaming: extracts status from response.completed event', async () => {
      const chunks = [
        {
          type: 'response.output_item.added',
          response: { model: 'gpt-4o' },
        },
        {
          type: 'response.output_text.delta',
          delta: 'Hello!',
        },
        {
          type: 'response.completed',
          response: {
            model: 'gpt-4o',
            status: 'completed',
            output: [
              {
                id: 'msg-001',
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'Hello!' }],
              },
            ],
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens_details: { reasoning_tokens: 0 },
            },
          },
        },
      ]

      const ResponsesMock: any = openaiModule.Responses
      ResponsesMock.prototype.create = jest.fn().mockImplementation(() => {
        const mockStream = {
          tee: jest.fn().mockReturnValue([createMockAsyncIterator(chunks), createMockAsyncIterator(chunks)]),
        }
        return Promise.resolve(mockStream)
      })

      const stream = await client.responses.create({
        model: 'gpt-4o',
        input: 'Hi',
        stream: true,
        posthogDistinctId: 'test-user',
      })

      for await (const _chunk of stream as any) {
        // consume
      }

      await flushPromises()

      const properties = getCapturedProperties(mockPostHogClient)
      expect(properties['$ai_stop_reason']).toBe('completed')
    })
  })

  describe('Anthropic', () => {
    let client: PostHogAnthropic

    beforeEach(() => {
      client = new PostHogAnthropic({
        apiKey: 'test-key',
        posthog: mockPostHogClient as any,
      })
    })

    test('non-streaming: extracts stop_reason', async () => {
      const mockResponse = {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-opus-20240229',
        content: [{ type: 'text', text: 'Hello!' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      }

      const MessagesMock = AnthropicOriginal.Messages as jest.MockedClass<typeof AnthropicOriginal.Messages>
      ;(MessagesMock.prototype.create as jest.Mock) = jest.fn().mockResolvedValue(mockResponse)

      await client.messages.create({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
        posthogDistinctId: 'test-user',
      })

      const properties = getCapturedProperties(mockPostHogClient)
      expect(properties['$ai_stop_reason']).toBe('end_turn')
    })

    test('non-streaming: extracts max_tokens stop_reason', async () => {
      const mockResponse = {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-opus-20240229',
        content: [{ type: 'text', text: 'Truncated...' }],
        stop_reason: 'max_tokens',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 100 },
      }

      const MessagesMock = AnthropicOriginal.Messages as jest.MockedClass<typeof AnthropicOriginal.Messages>
      ;(MessagesMock.prototype.create as jest.Mock) = jest.fn().mockResolvedValue(mockResponse)

      await client.messages.create({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Write a long essay' }],
        max_tokens: 100,
        posthogDistinctId: 'test-user',
      })

      const properties = getCapturedProperties(mockPostHogClient)
      expect(properties['$ai_stop_reason']).toBe('max_tokens')
    })

    test('streaming: extracts stop_reason from message_delta', async () => {
      const chunks = [
        {
          type: 'message_start',
          message: {
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            model: 'claude-3-opus-20240229',
            usage: { input_tokens: 10, output_tokens: 0 },
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hello!' },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { type: 'stop_reason', stop_reason: 'end_turn' },
          usage: { output_tokens: 5 },
        },
        { type: 'message_stop' },
      ]

      const MessagesMock = AnthropicOriginal.Messages as jest.MockedClass<typeof AnthropicOriginal.Messages>
      ;(MessagesMock.prototype.create as jest.Mock) = jest.fn().mockImplementation(() => {
        const mockStream = {
          tee: jest.fn().mockReturnValue([createMockAsyncIterator(chunks), createMockAsyncIterator(chunks)]),
        }
        return Promise.resolve(mockStream)
      })

      const stream = await client.messages.create({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
        stream: true,
        posthogDistinctId: 'test-user',
      })

      for await (const _chunk of stream as any) {
        // consume
      }

      await new Promise(process.nextTick)

      const properties = getCapturedProperties(mockPostHogClient)
      expect(properties['$ai_stop_reason']).toBe('end_turn')
    })
  })

  describe('Gemini', () => {
    let client: PostHogGemini

    beforeEach(() => {
      client = new PostHogGemini({
        apiKey: 'test-key',
        posthog: mockPostHogClient as any,
      })
    })

    test('non-streaming: extracts finishReason', async () => {
      const mockResponse = {
        text: 'Hello from Gemini!',
        candidates: [
          {
            content: { parts: [{ text: 'Hello from Gemini!' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      }

      ;(client as any).client.models.generateContent = jest.fn().mockResolvedValue(mockResponse)

      await client.models.generateContent({
        model: 'gemini-2.0-flash-001',
        contents: 'Hello',
        posthogDistinctId: 'test-user',
      })

      const properties = getCapturedProperties(mockPostHogClient)
      expect(properties['$ai_stop_reason']).toBe('STOP')
    })

    test('non-streaming: extracts MAX_TOKENS finishReason', async () => {
      const mockResponse = {
        text: 'Truncated...',
        candidates: [
          {
            content: { parts: [{ text: 'Truncated...' }] },
            finishReason: 'MAX_TOKENS',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 100,
          totalTokenCount: 110,
        },
      }

      ;(client as any).client.models.generateContent = jest.fn().mockResolvedValue(mockResponse)

      await client.models.generateContent({
        model: 'gemini-2.0-flash-001',
        contents: 'Write a long essay',
        posthogDistinctId: 'test-user',
      })

      const properties = getCapturedProperties(mockPostHogClient)
      expect(properties['$ai_stop_reason']).toBe('MAX_TOKENS')
    })

    test('streaming: extracts finishReason from final chunk', async () => {
      const streamChunks = [
        {
          text: 'Hello ',
          candidates: [{ content: { parts: [{ text: 'Hello ' }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
        },
        {
          text: 'world!',
          candidates: [
            {
              content: { parts: [{ text: 'world!' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        },
      ]

      ;(client as any).client.models.generateContentStream = jest.fn().mockImplementation(() => {
        return (async function* () {
          for (const chunk of streamChunks) {
            yield chunk
          }
        })()
      })

      const stream = client.models.generateContentStream({
        model: 'gemini-2.0-flash-001',
        contents: 'Hello',
        posthogDistinctId: 'test-user',
      })

      for await (const _chunk of stream) {
        // consume
      }

      const properties = getCapturedProperties(mockPostHogClient)
      expect(properties['$ai_stop_reason']).toBe('STOP')
    })
  })

  describe('Vercel AI SDK', () => {
    test('V2 doGenerate: extracts finishReason string', async () => {
      const baseModel: LanguageModelV2 = {
        specificationVersion: 'v2' as const,
        provider: 'openai',
        modelId: 'gpt-4',
        supportedUrls: {},
        doGenerate: jest.fn().mockResolvedValue({
          text: 'Hello!',
          usage: { inputTokens: 10, outputTokens: 5 },
          content: [{ type: 'text', text: 'Hello!' }],
          response: { modelId: 'gpt-4' },
          providerMetadata: {},
          finishReason: 'stop',
          warnings: [],
        }),
        doStream: jest.fn(),
      }

      const model = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
      })

      await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      } as any)

      const properties = getCapturedProperties(mockPostHogClient)
      expect(properties['$ai_stop_reason']).toBe('stop')
    })

    test('V3 doGenerate: extracts finishReason from object', async () => {
      const baseModel: LanguageModelV3 = {
        specificationVersion: 'v3' as const,
        provider: 'openai',
        modelId: 'gpt-4',
        supportedUrls: {},
        doGenerate: jest.fn().mockResolvedValue({
          text: 'Hello!',
          usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } },
          content: [{ type: 'text', text: 'Hello!' }],
          response: { modelId: 'gpt-4' },
          providerMetadata: {},
          finishReason: { unified: 'stop', raw: undefined },
          warnings: [],
        }),
        doStream: jest.fn(),
      }

      const model = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
      })

      await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      } as any)

      const properties = getCapturedProperties(mockPostHogClient)
      expect(properties['$ai_stop_reason']).toBe('stop')
    })

    test('V2 doStream: extracts finishReason from finish part', async () => {
      const streamParts: LanguageModelV2StreamPart[] = [
        { type: 'text-delta', id: 'text-1', delta: 'Hello!' },
        {
          type: 'finish',
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          finishReason: 'stop' as const,
        },
      ]

      const baseModel: LanguageModelV2 = {
        specificationVersion: 'v2' as const,
        provider: 'openai',
        modelId: 'gpt-4',
        supportedUrls: {},
        doGenerate: jest.fn(),
        doStream: jest.fn().mockImplementation(async () => {
          const stream = new ReadableStream({
            async start(controller) {
              for (const part of streamParts) {
                controller.enqueue(part)
              }
              controller.close()
            },
          })
          return { stream, response: { modelId: 'gpt-4' } }
        }),
      }

      const model = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test-trace',
      })

      const result = await model.doStream({
        prompt: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Hi' }] }],
      } as any)

      const reader = result.stream.getReader()
      while (!(await reader.read()).done) {
        // consume
      }

      await flushPromises()

      const properties = getCapturedProperties(mockPostHogClient)
      expect(properties['$ai_stop_reason']).toBe('stop')
    })

    test('V3 doStream: extracts finishReason from finish part', async () => {
      const streamParts: LanguageModelV3StreamPart[] = [
        { type: 'text-delta', id: 'text-1', delta: 'Hello!' },
        {
          type: 'finish',
          usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } },
          finishReason: { unified: 'stop' as const, raw: undefined },
        },
      ]

      const baseModel: LanguageModelV3 = {
        specificationVersion: 'v3' as const,
        provider: 'openai',
        modelId: 'gpt-4',
        supportedUrls: {},
        doGenerate: jest.fn(),
        doStream: jest.fn().mockImplementation(async () => {
          const stream = new ReadableStream({
            async start(controller) {
              for (const part of streamParts) {
                controller.enqueue(part)
              }
              controller.close()
            },
          })
          return { stream, response: { modelId: 'gpt-4' } }
        }),
      }

      const model = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test-trace',
      })

      const result = await model.doStream({
        prompt: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Hi' }] }],
      } as any)

      const reader = result.stream.getReader()
      while (!(await reader.read()).done) {
        // consume
      }

      await flushPromises()

      const properties = getCapturedProperties(mockPostHogClient)
      expect(properties['$ai_stop_reason']).toBe('stop')
    })
  })

  describe('LangChain', () => {
    test('extracts finish_reason from generationInfo (OpenAI format)', () => {
      const handler = new LangChainCallbackHandler({
        client: mockPostHogClient,
      })

      const serialized = {
        lc: 1,
        type: 'constructor' as const,
        id: ['langchain', 'llms', 'openai', 'OpenAI'],
        kwargs: {},
      }

      handler.handleLLMStart(serialized, ['Test prompt'], 'run-1', 'parent-1', {
        invocation_params: { temperature: 0.7 },
      }, undefined, { ls_model_name: 'gpt-4', ls_provider: 'openai' })

      handler.handleLLMEnd(
        {
          generations: [
            [
              {
                text: 'Hello!',
                message: new AIMessage('Hello!'),
                generationInfo: { finish_reason: 'stop' },
              },
            ],
          ],
          llmOutput: {
            tokenUsage: { promptTokens: 10, completionTokens: 5 },
          },
        },
        'run-1'
      )

      const properties = getCapturedProperties(mockPostHogClient)
      expect(properties['$ai_stop_reason']).toBe('stop')
    })

    test('extracts stop_reason from generationInfo (Anthropic format)', () => {
      const handler = new LangChainCallbackHandler({
        client: mockPostHogClient,
      })

      const serialized = {
        lc: 1,
        type: 'constructor' as const,
        id: ['langchain', 'llms', 'anthropic'],
        kwargs: {},
      }

      handler.handleLLMStart(serialized, ['Test prompt'], 'run-2', 'parent-2', {
        invocation_params: {},
      }, undefined, { ls_model_name: 'claude-3', ls_provider: 'anthropic' })

      handler.handleLLMEnd(
        {
          generations: [
            [
              {
                text: 'Hello!',
                message: new AIMessage('Hello!'),
                generationInfo: { stop_reason: 'end_turn' },
              },
            ],
          ],
          llmOutput: {
            tokenUsage: { promptTokens: 10, completionTokens: 5 },
          },
        },
        'run-2'
      )

      const properties = getCapturedProperties(mockPostHogClient)
      expect(properties['$ai_stop_reason']).toBe('end_turn')
    })

    test('does not include $ai_stop_reason when not available', () => {
      const handler = new LangChainCallbackHandler({
        client: mockPostHogClient,
      })

      const serialized = {
        lc: 1,
        type: 'constructor' as const,
        id: ['langchain', 'llms', 'openai', 'OpenAI'],
        kwargs: {},
      }

      handler.handleLLMStart(serialized, ['Test prompt'], 'run-3', 'parent-3', {
        invocation_params: {},
      }, undefined, { ls_model_name: 'gpt-4', ls_provider: 'openai' })

      handler.handleLLMEnd(
        {
          generations: [
            [
              {
                text: 'Hello!',
                message: new AIMessage('Hello!'),
              },
            ],
          ],
          llmOutput: {
            tokenUsage: { promptTokens: 10, completionTokens: 5 },
          },
        },
        'run-3'
      )

      const properties = getCapturedProperties(mockPostHogClient)
      expect(properties['$ai_stop_reason']).toBeUndefined()
    })
  })

  describe('stop reason is omitted when absent', () => {
    test('OpenAI non-streaming: no stop reason when finish_reason is null', async () => {
      const mockResponse: ChatCompletion = {
        id: 'test-id',
        model: 'gpt-4',
        object: 'chat.completion',
        created: Date.now() / 1000,
        choices: [
          {
            index: 0,
            finish_reason: null as any,
            message: { role: 'assistant', content: 'Hello!', refusal: null },
            logprobs: null,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }

      const client = new PostHogOpenAI({
        apiKey: 'test-key',
        posthog: mockPostHogClient as any,
      })

      const ChatMock: any = openaiModule.Chat
      ;(ChatMock.Completions as any).prototype.create = jest.fn().mockResolvedValue(mockResponse)

      await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        posthogDistinctId: 'test-user',
      })

      const properties = getCapturedProperties(mockPostHogClient)
      expect(properties['$ai_stop_reason']).toBeUndefined()
    })
  })
})
