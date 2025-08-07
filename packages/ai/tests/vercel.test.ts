import { PostHog } from 'posthog-node'
import { withTracing } from '../src/index'
import { generateText, streamText } from 'ai'
import type { LanguageModelV2, LanguageModelV2CallOptions } from '@ai-sdk/provider'

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

// Mock AI SDK's generateText to simulate its behavior
jest.mock('ai', () => ({
  generateText: jest.fn(async ({ model, prompt }) => {
    // Simulate what generateText does - convert prompt and call model
    const messages = typeof prompt === 'string' ? [{ role: 'user', content: prompt }] : prompt

    const result = await model.doGenerate({ prompt: messages })

    return {
      text: result.text,
      usage: {
        promptTokens: result.usage.inputTokens,
        completionTokens: result.usage.outputTokens,
        totalTokens: result.usage.inputTokens + result.usage.outputTokens,
      },
    }
  }),
  streamText: jest.fn(),
  wrapLanguageModel: jest.fn(({ model, middleware }) => {
    // Apply the middleware to the model
    const wrappedModel = {
      ...model,
      doGenerate: async (params: any) => {
        return middleware.wrapGenerate({
          doGenerate: async () => model.doGenerate(params),
          params,
          model,
        })
      },
      doStream: model.doStream,
    }
    return wrappedModel
  }),
}))

// Create a mock openai function that returns a properly structured model
const createMockModel = (modelId: string): LanguageModelV2 => {
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
      // Extract the prompt text from the params
      const userMessage = params.prompt.find((m: any) => m.role === 'user')
      const promptText = userMessage?.content as string
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
        logprobs: undefined,
        warnings: [],
      }
    }),
    doStream: jest.fn(),
  } as LanguageModelV2
}

describe('Vercel AI SDK v5 Middleware - End User Usage', () => {
  let mockPostHogClient: PostHog

  beforeEach(async () => {
    jest.clearAllMocks()
    mockPostHogClient = new (PostHog as any)()
  })

  describe('generateText with withTracing (real usage)', () => {
    it('should wrap a model and track simple prompt generation', async () => {
      const baseModel = createMockModel('gpt-4')
      const model = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test123',
        posthogProperties: {
          test: 'test',
        },
        posthogGroups: {
          company: 'test-company',
        },
      })

      const result = await generateText({
        model: model,
        prompt: 'What is 9 + 10?',
      })

      expect(result.text).toBe('19')
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 2,
        totalTokens: 12,
      })

      // Verify PostHog was called
      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
      expect(captureCall[0]).toEqual({
        distinctId: 'test-user',
        event: '$ai_generation',
        properties: expect.objectContaining({
          $ai_model: 'gpt-4',
          $ai_provider: 'openai',
          $ai_trace_id: 'test123',
          test: 'test',
          $ai_input_tokens: 10,
          $ai_output_tokens: 2,
          $ai_input: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.arrayContaining([
                expect.objectContaining({
                  type: 'text',
                  text: 'What is 9 + 10?',
                }),
              ]),
            }),
          ]),
          $ai_output_choices: expect.arrayContaining([
            expect.objectContaining({
              role: 'assistant',
              content: '19',
            }),
          ]),
        }),
        groups: { company: 'test-company' },
      })
    })

    it('should handle multiple sequential calls', async () => {
      const baseModel = createMockModel('gpt-4.1')
      const model = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test123',
      })

      const { text: text1 } = await generateText({
        model: model,
        prompt: 'What is 9 + 10?',
      })

      const { text: text2 } = await generateText({
        model: model,
        prompt: 'What is 10 + 11?',
      })

      const { text: text3 } = await generateText({
        model: model,
        prompt: 'What is 12 + 13?',
      })

      expect(text1).toBe('19')
      expect(text2).toBe('21')
      expect(text3).toBe('25')

      // Verify PostHog was called 3 times
      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(3)

      // Verify each call had the correct trace ID
      const calls = (mockPostHogClient.capture as jest.Mock).mock.calls
      calls.forEach((call) => {
        expect(call[0].properties.$ai_trace_id).toBe('test123')
      })
    })

    it('should track PostHog events with properties and groups', async () => {
      const baseModel = createMockModel('gpt-4')
      const model = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test123',
        posthogProperties: {
          test: 'test',
        },
        posthogGroups: {
          company: 'test-vercel',
        },
      })

      const result = await generateText({
        model: model,
        prompt: 'What is 9 + 10?',
      })

      expect(result.text).toBe('19')

      // Check that PostHog capture was called
      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

      expect(captureCall[0]).toEqual({
        distinctId: 'test-user',
        event: '$ai_generation',
        properties: expect.objectContaining({
          $ai_model: 'gpt-4',
          $ai_provider: 'openai',
          $ai_trace_id: 'test123',
          test: 'test', // Custom properties
          $ai_input_tokens: 10,
          $ai_output_tokens: 2,
          $ai_input: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.arrayContaining([
                expect.objectContaining({
                  type: 'text',
                  text: 'What is 9 + 10?',
                }),
              ]),
            }),
          ]),
          $ai_output_choices: expect.arrayContaining([
            expect.objectContaining({
              role: 'assistant',
              content: '19',
            }),
          ]),
        }),
        groups: { company: 'test-vercel' },
      })
    })

    it('should handle error cases', async () => {
      const baseModel = createMockModel('gpt-4')
      // Override doGenerate to throw an error
      baseModel.doGenerate = jest.fn().mockRejectedValue(new Error('API Error'))

      const model = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test-error',
      })

      await expect(
        generateText({
          model: model,
          prompt: 'What is 9 + 10?',
        })
      ).rejects.toThrow('API Error')

      // Verify error was tracked
      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

      expect(captureCall[0].properties).toEqual(
        expect.objectContaining({
          $ai_trace_id: 'test-error',
          $ai_error: expect.any(String), // Error is serialized to JSON
          $ai_is_error: true,
          $ai_model: 'gpt-4',
          $ai_provider: 'openai',
          $ai_input_tokens: 0,
          $ai_output_tokens: 0,
        })
      )
    })
  })
})
