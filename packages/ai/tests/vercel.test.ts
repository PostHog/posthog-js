import { PostHog } from 'posthog-node'
import { withTracing } from '../src/index'
import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2StreamPart,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider'
import { flushPromises } from './test-utils'
import { version } from '../package.json'

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

// Extract prompt text from message content (handles both string and array formats)
const getPromptText = (content: any): string => {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const textPart = content.find((c: any) => c.type === 'text')
    return textPart?.text || ''
  }
  return ''
}

// Helper to create V3-style token usage object
const v3TokenUsage = (input: number, output: number, reasoning?: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: output, text: output - (reasoning ?? 0), reasoning: reasoning },
})

// Create a mock V3 model (AI SDK 6)
const createMockV3Model = (modelId: string): LanguageModelV3 => {
  const mockResponses = {
    'What is 9 + 10?': { text: '19', usage: v3TokenUsage(10, 2) },
    'What is 10 + 11?': { text: '21', usage: v3TokenUsage(10, 2) },
    'What is 12 + 13?': { text: '25', usage: v3TokenUsage(10, 2) },
  }

  return {
    specificationVersion: 'v3' as const,
    provider: 'openai',
    modelId: modelId,
    supportedUrls: {},
    doGenerate: jest.fn().mockImplementation(async (params: LanguageModelV3CallOptions) => {
      const userMessage = params.prompt.find((m: any) => m.role === 'user')
      const promptText = getPromptText(userMessage?.content)
      const response = mockResponses[promptText as keyof typeof mockResponses] || {
        text: 'Unknown',
        usage: v3TokenUsage(5, 1),
      }

      return {
        text: response.text,
        usage: response.usage,
        content: [{ type: 'text', text: response.text }],
        response: { modelId: modelId },
        providerMetadata: {},
        finishReason: 'stop',
        warnings: [],
      }
    }),
    doStream: jest.fn(),
  } as LanguageModelV3
}

// Create a mock V2 model (AI SDK 5)
const createMockV2Model = (modelId: string): LanguageModelV2 => {
  const mockResponses = {
    'What is 9 + 10?': { text: '19', usage: { inputTokens: 10, outputTokens: 2 } },
    'What is 10 + 11?': { text: '21', usage: { inputTokens: 10, outputTokens: 2 } },
    'What is 12 + 13?': { text: '25', usage: { inputTokens: 10, outputTokens: 2 } },
  }

  return {
    specificationVersion: 'v2' as const,
    provider: 'openai',
    modelId: modelId,
    supportedUrls: {},
    doGenerate: jest.fn().mockImplementation(async (params: LanguageModelV2CallOptions) => {
      const userMessage = params.prompt.find((m: any) => m.role === 'user')
      const promptText = getPromptText(userMessage?.content)
      const response = mockResponses[promptText as keyof typeof mockResponses] || {
        text: 'Unknown',
        usage: { inputTokens: 5, outputTokens: 1 },
      }

      return {
        text: response.text,
        usage: response.usage,
        content: [{ type: 'text', text: response.text }],
        response: { modelId: modelId },
        providerMetadata: {},
        finishReason: 'stop',
        warnings: [],
      }
    }),
    doStream: jest.fn(),
  } as LanguageModelV2
}

// Helper to extract numeric token value from V2 (number) or V3 (object with .total) formats
const extractTokenValue = (value: unknown): number => {
  if (typeof value === 'number') return value
  if (
    value &&
    typeof value === 'object' &&
    'total' in value &&
    typeof (value as { total: unknown }).total === 'number'
  ) {
    return (value as { total: number }).total
  }
  return 0
}

// Simulate what generateText does - works with both V2 and V3
const simulateGenerateText = async ({ model, prompt }: { model: any; prompt: string }) => {
  const messages = [{ role: 'user' as const, content: [{ type: 'text' as const, text: prompt }] }]
  const result = await model.doGenerate({ prompt: messages })

  const promptTokens = extractTokenValue(result.usage.inputTokens)
  const completionTokens = extractTokenValue(result.usage.outputTokens)

  return {
    text: result.content[0]?.text || result.text,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    },
  }
}

// Helper to create streaming model for both versions
const createMockStreamingModel = <T extends 'v2' | 'v3'>(
  version: T,
  streamParts: T extends 'v3' ? LanguageModelV3StreamPart[] : LanguageModelV2StreamPart[]
): T extends 'v3' ? LanguageModelV3 : LanguageModelV2 => {
  const baseModel = {
    specificationVersion: version as any,
    provider: 'test-provider',
    modelId: 'test-streaming-model',
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

      return {
        stream,
        response: { modelId: 'test-streaming-model' },
      }
    }),
  }

  return baseModel as any
}

describe('Vercel AI SDK - Dual Version Support', () => {
  let mockPostHogClient: PostHog

  beforeEach(async () => {
    jest.clearAllMocks()
    mockPostHogClient = new (PostHog as any)()
  })

  describe('V3 Model (AI SDK 6)', () => {
    it('should wrap a V3 model and track generation', async () => {
      const baseModel = createMockV3Model('gpt-4')
      const model = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test123',
        posthogProperties: { test: 'test' },
        posthogGroups: { company: 'test-company' },
      })

      // Verify the wrapped model preserves V3 type
      expect(model.specificationVersion).toBe('v3')

      const result = await simulateGenerateText({
        model: model,
        prompt: 'What is 9 + 10?',
      })

      expect(result.text).toBe('19')
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 2,
        totalTokens: 12,
      })

      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

      expect(captureCall[0].properties['$ai_lib']).toBe('posthog-ai')
      expect(captureCall[0].properties['$ai_lib_version']).toBe(version)
      expect(captureCall[0].properties['$ai_framework']).toBe('vercel')
      expect(captureCall[0].properties['$ai_model']).toBe('gpt-4')
      expect(captureCall[0].properties['$ai_provider']).toBe('openai')
    })

    it('should handle V3 streaming with tool calls', async () => {
      const streamParts: LanguageModelV3StreamPart[] = [
        { type: 'text-delta', id: 'text-1', delta: 'Let me check ' },
        { type: 'tool-input-start', id: 'tc-1', toolName: 'get_weather' },
        { type: 'tool-input-delta', id: 'tc-1', delta: '{"location":"NYC"}' },
        { type: 'tool-input-end', id: 'tc-1' },
        {
          type: 'finish',
          usage: v3TokenUsage(20, 15),
          finishReason: 'stop',
        },
      ]

      const baseModel = createMockStreamingModel('v3', streamParts)
      const model = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test-v3-stream',
      })

      const result = await model.doStream({
        prompt: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Weather?' }] }],
      })

      const reader = result.stream.getReader()
      while (!(await reader.read()).done) {
        // Consume stream
      }

      await flushPromises()

      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

      expect(captureCall[0].properties.$ai_output_choices).toEqual([
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check ' },
            {
              type: 'tool-call',
              id: 'tc-1',
              function: { name: 'get_weather', arguments: '{"location":"NYC"}' },
            },
          ],
        },
      ])
    })
  })

  describe('V2 Model (AI SDK 5)', () => {
    it('should wrap a V2 model and track generation', async () => {
      const baseModel = createMockV2Model('gpt-4')
      const model = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test456',
        posthogProperties: { test: 'v2-test' },
        posthogGroups: { company: 'test-company-v2' },
      })

      // Verify the wrapped model preserves V2 type
      expect(model.specificationVersion).toBe('v2')

      const result = await simulateGenerateText({
        model: model,
        prompt: 'What is 9 + 10?',
      })

      expect(result.text).toBe('19')
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 2,
        totalTokens: 12,
      })

      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

      expect(captureCall[0].properties['$ai_lib']).toBe('posthog-ai')
      expect(captureCall[0].properties['$ai_lib_version']).toBe(version)
      expect(captureCall[0].properties['$ai_framework']).toBe('vercel')
      expect(captureCall[0].properties['$ai_model']).toBe('gpt-4')
      expect(captureCall[0].properties['$ai_provider']).toBe('openai')
    })

    it('should handle V2 streaming with tool calls', async () => {
      const streamParts: LanguageModelV2StreamPart[] = [
        { type: 'text-delta', id: 'text-1', delta: 'Processing ' },
        { type: 'tool-input-start', id: 'tc-1', toolName: 'calculate' },
        { type: 'tool-input-delta', id: 'tc-1', delta: '{"a":5,"b":3}' },
        { type: 'tool-input-end', id: 'tc-1' },
        {
          type: 'finish',
          usage: { inputTokens: 15, outputTokens: 10, totalTokens: 25 },
          finishReason: 'stop',
        },
      ]

      const baseModel = createMockStreamingModel('v2', streamParts)
      const model = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test-v2-stream',
      })

      const result = await model.doStream({
        prompt: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Calculate' }] }],
      })

      const reader = result.stream.getReader()
      while (!(await reader.read()).done) {
        // Consume stream
      }

      await flushPromises()

      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

      expect(captureCall[0].properties.$ai_output_choices).toEqual([
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Processing ' },
            {
              type: 'tool-call',
              id: 'tc-1',
              function: { name: 'calculate', arguments: '{"a":5,"b":3}' },
            },
          ],
        },
      ])
    })
  })

  describe('Shared behavior (both versions)', () => {
    it.each([
      ['v2', createMockV2Model],
      ['v3', createMockV3Model],
    ])('should handle errors in %s models', async (_version, createModel) => {
      const baseModel = createModel('gpt-4')
      baseModel.doGenerate = jest.fn().mockRejectedValue(new Error('API Error'))

      const model = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test-error',
      })

      await expect(
        simulateGenerateText({
          model: model,
          prompt: 'What is 9 + 10?',
        })
      ).rejects.toThrow('API Error')

      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

      expect(captureCall[0].properties).toEqual(
        expect.objectContaining({
          $ai_trace_id: 'test-error',
          $ai_error: expect.any(String),
          $ai_is_error: true,
          $ai_model: 'gpt-4',
          $ai_provider: 'openai',
        })
      )
    })

    it.each([
      ['v2', createMockV2Model],
      ['v3', createMockV3Model],
    ])('should handle multiple sequential calls in %s models', async (_version, createModel) => {
      const baseModel = createModel('gpt-4.1')
      const model = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test-sequential',
      })

      const { text: text1 } = await simulateGenerateText({ model, prompt: 'What is 9 + 10?' })
      const { text: text2 } = await simulateGenerateText({ model, prompt: 'What is 10 + 11?' })
      const { text: text3 } = await simulateGenerateText({ model, prompt: 'What is 12 + 13?' })

      expect(text1).toBe('19')
      expect(text2).toBe('21')
      expect(text3).toBe('25')

      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(3)

      const calls = (mockPostHogClient.capture as jest.Mock).mock.calls
      calls.forEach((call) => {
        expect(call[0].properties.$ai_trace_id).toBe('test-sequential')
        expect(call[0].properties['$ai_lib']).toBe('posthog-ai')
      })
    })

    it.each([
      ['v2', createMockV2Model, { inputTokens: 15, outputTokens: 5 }],
      ['v3', createMockV3Model, v3TokenUsage(15, 5)],
    ])('should track tools in %s models when provided', async (_version, createModel, usageFormat) => {
      const baseModel = createModel('gpt-4')
      baseModel.doGenerate = jest.fn().mockImplementation(async () => ({
        text: 'Using tool',
        usage: usageFormat,
        content: [{ type: 'text', text: 'Using tool' }],
        response: { modelId: 'gpt-4' },
        providerMetadata: {},
        finishReason: 'stop',
        warnings: [],
      }))

      const model = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test-tools',
      })

      const tools = [
        {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object' as const, properties: { location: { type: 'string' as const } } },
        },
      ]

      await model.doGenerate({
        prompt: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Weather?' }] }],
        tools: tools as any,
      } as any)

      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

      expect(captureCall[0].properties.$ai_tools).toEqual(tools)
    })

    it.each([
      ['v2', createMockV2Model],
      ['v3', createMockV3Model],
    ])('should respect privacy mode in %s models', async (_version, createModel) => {
      const baseModel = createModel('gpt-4')
      const model = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test-privacy',
        posthogPrivacyMode: true,
      })

      await simulateGenerateText({ model, prompt: 'What is 9 + 10?' })

      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

      // Input should be null in privacy mode (withPrivacyMode returns null)
      expect(captureCall[0].properties.$ai_input).toBeNull()
    })
  })

  describe('Prototype getter preservation', () => {
    it('should preserve getter properties from the prototype chain', async () => {
      class ModelWithGetters {
        specificationVersion = 'v3' as const
        modelId = 'test-model'
        provider = 'test-provider'

        get supportedUrls() {
          return {
            'image/*': ['http', 'https', 'data'],
            'application/pdf': ['http', 'https', 'data'],
          }
        }

        get customGetter() {
          return 'custom-value'
        }

        doGenerate = jest.fn().mockResolvedValue({
          text: 'test',
          usage: { inputTokens: { total: 5 }, outputTokens: { total: 2 } },
          content: [{ type: 'text', text: 'test' }],
          response: { modelId: 'test-model' },
          providerMetadata: {},
          finishReason: 'stop',
          warnings: [],
        })

        doStream = jest.fn()
      }

      const baseModel = new ModelWithGetters() as any
      const wrappedModel = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test-getters',
      })

      // Verify the wrapped model preserves prototype getters
      expect(wrappedModel.supportedUrls).toEqual({
        'image/*': ['http', 'https', 'data'],
        'application/pdf': ['http', 'https', 'data'],
      })
      expect(wrappedModel.customGetter).toBe('custom-value')

      // Verify the model still works
      await wrappedModel.doGenerate({
        prompt: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Test' }] }],
      })

      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    })
  })

  describe('Mixed reasoning and text content', () => {
    it.each([
      ['v2', { inputTokens: 10, outputTokens: 8, totalTokens: 18, reasoningTokens: 5 }],
      ['v3', v3TokenUsage(10, 8, 5)],
    ] as const)('should handle reasoning in %s streaming', async (version, usageFormat) => {
      const streamParts = [
        { type: 'reasoning-delta' as const, id: 'r-1', delta: 'Thinking about ' },
        { type: 'reasoning-delta' as const, id: 'r-1', delta: 'the answer.' },
        { type: 'text-delta' as const, id: 't-1', delta: 'The answer is 19.' },
        {
          type: 'finish' as const,
          usage: usageFormat,
          finishReason: 'stop' as const,
        },
      ]

      const baseModel = createMockStreamingModel(version, streamParts as any)
      const model = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test-reasoning',
      })

      const result = await model.doStream({
        prompt: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Think' }] }],
      })

      const reader = result.stream.getReader()
      while (!(await reader.read()).done) {
        // Consume
      }

      await flushPromises()

      const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
      expect(captureCall[0].properties.$ai_output_choices).toEqual([
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'Thinking about the answer.' },
            { type: 'text', text: 'The answer is 19.' },
          ],
        },
      ])
      expect(captureCall[0].properties.$ai_reasoning_tokens).toBe(5)
    })
  })
})
