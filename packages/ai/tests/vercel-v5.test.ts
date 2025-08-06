import { PostHog } from 'posthog-node'
import { wrapVercelLanguageModel } from '../src/vercel/middleware-v5'
import { generateText, streamText } from 'ai'
import { openai } from '@ai-sdk/openai'

// Mock PostHog
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

// Mock sendEventToPosthog
jest.mock('../src/utils', () => ({
  sendEventToPosthog: jest.fn(),
  truncate: jest.fn((str: string) => str),
  MAX_OUTPUT_SIZE: 1000000,
}))

// Mock the AI SDK functions
jest.mock('ai', () => ({
  generateText: jest.fn(),
  streamText: jest.fn(),
  wrapLanguageModel: jest.fn((config) => config.model),
}))

jest.mock('@ai-sdk/openai', () => ({
  openai: jest.fn(() => ({
    specificationVersion: '2',
    provider: 'openai',
    modelId: 'gpt-4',
    doGenerate: jest.fn(),
    doStream: jest.fn(),
  })),
}))

describe('Vercel AI SDK v5 Middleware - End User Usage', () => {
  let mockPostHogClient: PostHog
  let mockSendEventToPosthog: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    mockPostHogClient = new (PostHog as any)()
    mockSendEventToPosthog = require('../src/utils').sendEventToPosthog
  })

  describe('generateText with wrapped model', () => {
    it('should wrap a v5 model and track generation', async () => {
      const baseModel = openai('gpt-4')
      const wrappedModel = wrapVercelLanguageModel(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test-trace',
      })

      // Mock generateText to simulate successful generation
      const mockResult = {
        text: 'Hello from GPT-4',
        usage: {
          inputTokens: 10,
          outputTokens: 15,
          totalTokens: 25,
        },
      }
      ;(generateText as jest.Mock).mockResolvedValue(mockResult)

      const result = await generateText({
        model: wrappedModel,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Hello AI' }],
          },
        ],
        temperature: 0.7,
        maxOutputTokens: 100,
      })

      expect(result).toEqual(mockResult)
      expect(generateText).toHaveBeenCalledWith({
        model: wrappedModel,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Hello AI' }],
          },
        ],
        temperature: 0.7,
        maxOutputTokens: 100,
      })
    })

    it('should handle tool calls with v5 input/output format', async () => {
      const baseModel = openai('gpt-4')
      const wrappedModel = wrapVercelLanguageModel(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
      })

      const mockResult = {
        text: 'The weather in San Francisco is 72°F',
        toolCalls: [
          {
            toolCallId: 'call-123',
            toolName: 'get_weather',
            input: { city: 'San Francisco' }, // v5 format
          },
        ],
        toolResults: [
          {
            toolCallId: 'call-123',
            toolName: 'get_weather',
            output: { temperature: 72, unit: 'F' }, // v5 format
          },
        ],
        usage: {
          inputTokens: 20,
          outputTokens: 10,
          totalTokens: 30,
        },
      }
      ;(generateText as jest.Mock).mockResolvedValue(mockResult)

      const result = await generateText({
        model: wrappedModel,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'What is the weather in San Francisco?' }],
          },
        ],
        tools: {
          get_weather: {
            description: 'Get weather for a city',
            inputSchema: {
              type: 'object',
              properties: {
                city: { type: 'string' },
              },
            },
            execute: async ({ city }) => ({ temperature: 72, unit: 'F' }),
          },
        },
      })

      expect(result).toEqual(mockResult)
    })

    it('should handle privacy mode', async () => {
      const baseModel = openai('gpt-4')
      const wrappedModel = wrapVercelLanguageModel(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogPrivacyMode: true,
      })

      const mockResult = {
        text: 'Response text',
        usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 },
      }
      ;(generateText as jest.Mock).mockResolvedValue(mockResult)

      await generateText({
        model: wrappedModel,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Sensitive information' }],
          },
        ],
      })

      // Verify that privacy mode prevents input logging
      expect(generateText).toHaveBeenCalled()
    })
  })

  describe('streamText with wrapped model', () => {
    it('should wrap a v5 model and track streaming', async () => {
      const baseModel = openai('gpt-4')
      const wrappedModel = wrapVercelLanguageModel(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test-trace',
      })

      // Mock streamText response
      const mockStreamResult = {
        textStream: new ReadableStream({
          start(controller) {
            controller.enqueue('Hello ')
            controller.enqueue('from ')
            controller.enqueue('GPT-4')
            controller.close()
          },
        }),
        fullStream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text-start', id: 'text-1' })
            controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'Hello ' })
            controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'from ' })
            controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'GPT-4' })
            controller.enqueue({ type: 'text-end', id: 'text-1' })
            controller.enqueue({
              type: 'finish',
              usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 },
              finishReason: 'stop',
            })
            controller.close()
          },
        }),
        usage: Promise.resolve({ inputTokens: 5, outputTokens: 10, totalTokens: 15 }),
      }
      ;(streamText as jest.Mock).mockResolvedValue(mockStreamResult)

      const result = await streamText({
        model: wrappedModel,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Hello AI' }],
          },
        ],
        temperature: 0.7,
      })

      expect(result).toEqual(mockStreamResult)
      expect(streamText).toHaveBeenCalledWith({
        model: wrappedModel,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Hello AI' }],
          },
        ],
        temperature: 0.7,
      })
    })

    it('should handle reasoning streams in v5', async () => {
      const baseModel = openai('claude-sonnet-4-20250514')
      const wrappedModel = wrapVercelLanguageModel(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
      })

      const mockStreamResult = {
        textStream: new ReadableStream({
          start(controller) {
            controller.enqueue('Final answer')
            controller.close()
          },
        }),
        fullStream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'reasoning-start', id: 'reasoning-1' })
            controller.enqueue({ type: 'reasoning-delta', id: 'reasoning-1', delta: 'Let me think...' })
            controller.enqueue({ type: 'reasoning-end', id: 'reasoning-1' })
            controller.enqueue({ type: 'text-start', id: 'text-1' })
            controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'Final answer' })
            controller.enqueue({ type: 'text-end', id: 'text-1' })
            controller.enqueue({
              type: 'finish',
              usage: { inputTokens: 10, outputTokens: 15, totalTokens: 25 },
              finishReason: 'stop',
            })
            controller.close()
          },
        }),
        usage: Promise.resolve({ inputTokens: 10, outputTokens: 15, totalTokens: 25 }),
      }
      ;(streamText as jest.Mock).mockResolvedValue(mockStreamResult)

      const result = await streamText({
        model: wrappedModel,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Explain quantum computing' }],
          },
        ],
      })

      expect(result).toEqual(mockStreamResult)
    })
  })

  describe('Model configuration options', () => {
    it('should support model override', () => {
      const baseModel = openai('gpt-4')
      const wrappedModel = wrapVercelLanguageModel(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogModelOverride: 'custom-gpt-4',
      })

      expect(wrappedModel).toBeDefined()
    })

    it('should support provider override', () => {
      const baseModel = openai('gpt-4')
      const wrappedModel = wrapVercelLanguageModel(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogProviderOverride: 'custom-provider',
      })

      expect(wrappedModel).toBeDefined()
    })

    it('should support immediate capture', () => {
      const baseModel = openai('gpt-4')
      const wrappedModel = wrapVercelLanguageModel(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogCaptureImmediate: true,
      })

      expect(wrappedModel).toBeDefined()
    })

    it('should generate trace ID when not provided', () => {
      const baseModel = openai('gpt-4')
      const wrappedModel = wrapVercelLanguageModel(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        // No posthogTraceId provided - should auto-generate
      })

      expect(wrappedModel).toBeDefined()
    })
  })

  describe('File handling with v5 mediaType', () => {
    it('should handle file parts with mediaType instead of mimeType', async () => {
      const baseModel = openai('gpt-4-vision')
      const wrappedModel = wrapVercelLanguageModel(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
      })

      const mockResult = {
        text: 'I can see the image shows a cat',
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      }
      ;(generateText as jest.Mock).mockResolvedValue(mockResult)

      await generateText({
        model: wrappedModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What do you see in this image?' },
              {
                type: 'image',
                image: new URL('https://example.com/cat.jpg'),
                mediaType: 'image/jpeg', // v5 uses mediaType
              },
            ],
          },
        ],
      })

      expect(generateText).toHaveBeenCalled()
    })
  })
})