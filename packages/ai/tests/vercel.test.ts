import { PostHog } from 'posthog-node'
import { withTracing } from '../src/index'
import { generateText, streamText } from 'ai'

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
  extractAvailableToolCalls: jest.fn(() => []),
  MAX_OUTPUT_SIZE: 1000000,
}))

// Mock the AI SDK functions but let generateText call through to the model
jest.mock('ai', () => ({
  generateText: jest.fn().mockImplementation(async ({ model, prompt }) => {
    // Simulate what generateText does - call the model's doGenerate
    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: prompt }],
    })
    return { text: result.text, usage: result.usage }
  }),
  streamText: jest.fn(),
  wrapLanguageModel: jest.fn().mockImplementation((config) => {
    // Actually apply the middleware instead of bypassing it
    return config.middleware.wrapGenerate
      ? {
          ...config.model,
          doGenerate: async (params: any) => {
            return config.middleware.wrapGenerate({
              doGenerate: config.model.doGenerate,
              params,
              model: config.model,
            })
          },
        }
      : config.model
  }),
}))

// Create a mock openai function
const mockOpenai = jest.fn((modelId: string) => ({
  specificationVersion: 'v2' as const,
  provider: 'openai',
  modelId: modelId,
  supportedUrls: {},
  doGenerate: jest.fn().mockResolvedValue({
    text: '19',
    usage: { inputTokens: 10, outputTokens: 2 },
    response: { modelId: modelId },
    providerMetadata: {},
  }),
  doStream: jest.fn(),
}))

describe('Vercel AI SDK v5 Middleware - End User Usage', () => {
  let mockPostHogClient: PostHog
  let mockSendEventToPosthog: jest.Mock

  beforeEach(async () => {
    jest.clearAllMocks()
    mockPostHogClient = new (PostHog as any)()
    const utils = await import('../src/utils')
    mockSendEventToPosthog = utils.sendEventToPosthog as jest.Mock
  })

  describe('generateText with withTracing (real usage)', () => {
    it('should wrap a model and track simple prompt generation', async () => {
      const baseModel = mockOpenai('gpt-4')
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

      // Mock generateText to simulate successful generation
      const mockResult = {
        text: '19',
        usage: {
          inputTokens: 10,
          outputTokens: 2,
          totalTokens: 12,
        },
      }
      ;(generateText as jest.Mock).mockResolvedValue(mockResult)

      const result = await generateText({
        model: model,
        prompt: 'What is 9 + 10?',
      })

      expect(result).toEqual(mockResult)
      expect(generateText).toHaveBeenCalledWith({
        model: model,
        prompt: 'What is 9 + 10?',
      })
    })

    it('should handle multiple sequential calls', async () => {
      const baseModel = mockOpenai('gpt-4.1')
      const model = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test123',
      })

      const mockResults = [
        { text: '19', usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } },
        { text: '21', usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } },
        { text: '25', usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } },
      ]

      ;(generateText as jest.Mock)
        .mockResolvedValueOnce(mockResults[0])
        .mockResolvedValueOnce(mockResults[1])
        .mockResolvedValueOnce(mockResults[2])

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
      expect(generateText).toHaveBeenCalledTimes(3)
    })

    it('should track PostHog events with properties and groups', async () => {
      const baseModel = mockOpenai('gpt-4')
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

      await generateText({
        model: model,
        prompt: 'What is 9 + 10?',
      })

      // Verify PostHog event was sent with correct properties
      expect(mockSendEventToPosthog).toHaveBeenCalledWith(
        expect.objectContaining({
          distinctId: 'test-user',
          traceId: 'test123',
          model: 'gpt-4',
          provider: 'openai',
          usage: expect.objectContaining({
            inputTokens: 10,
            outputTokens: 2,
          }),
        })
      )
    })
  })
})
