import { PostHog } from 'posthog-node'
import { withTracing } from '../src/index'
import { generateText, wrapLanguageModel } from 'ai'
import type { LanguageModelV2, LanguageModelV2CallOptions, LanguageModelV2StreamPart } from '@ai-sdk/provider'
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

      // Verify $ai_lib and $ai_lib_version
      expect(captureCall[0].properties['$ai_lib']).toBe('posthog-ai')
      expect(captureCall[0].properties['$ai_lib_version']).toBe(version)

      // Verify $ai_lib_metadata for Vercel
      expect(captureCall[0].properties['$ai_lib_metadata']).toEqual({
        schema: 'v1',
        frameworks: [{ name: 'vercel' }],
      })

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

      // Verify each call had the correct trace ID and library properties
      const calls = (mockPostHogClient.capture as jest.Mock).mock.calls
      calls.forEach((call) => {
        expect(call[0].properties.$ai_trace_id).toBe('test123')
        expect(call[0].properties['$ai_lib']).toBe('posthog-ai')
        expect(call[0].properties['$ai_lib_version']).toBe(version)
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

      // Verify $ai_lib and $ai_lib_version
      expect(captureCall[0].properties['$ai_lib']).toBe('posthog-ai')
      expect(captureCall[0].properties['$ai_lib_version']).toBe(version)

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

      // Verify $ai_lib and $ai_lib_version
      expect(captureCall[0].properties['$ai_lib']).toBe('posthog-ai')
      expect(captureCall[0].properties['$ai_lib_version']).toBe(version)

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

    it('should track tools in PostHog event when tools are provided', async () => {
      const baseModel = createMockModel('gpt-4')
      const model = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test-tools',
      })

      // Mock doGenerate to handle tools
      baseModel.doGenerate = jest.fn().mockImplementation(async (_params: LanguageModelV2CallOptions) => {
        return {
          text: 'I will use the weather tool',
          usage: { inputTokens: 15, outputTokens: 5 },
          content: [{ type: 'text', text: 'I will use the weather tool' }],
          response: { modelId: 'gpt-4' },
          providerMetadata: {},
          finishReason: 'stop',
          logprobs: undefined,
          warnings: [],
        }
      })

      // Define tools for the request
      const tools = [
        {
          name: 'get_weather',
          description: 'Get the weather for a location',
          parameters: {
            type: 'object' as const,
            properties: {
              location: { type: 'string' as const },
            },
            required: ['location'],
          },
        },
        {
          name: 'search',
          description: 'Search for information',
          parameters: {
            type: 'object' as const,
            properties: {
              query: { type: 'string' as const },
            },
            required: ['query'],
          },
        },
      ]

      // Mock generateText to pass tools to the model
      const mockGenerateText = generateText as jest.Mock
      mockGenerateText.mockImplementation(async ({ model, prompt, tools }) => {
        // Pass tools to the model's doGenerate via params
        const messages = typeof prompt === 'string' ? [{ role: 'user', content: prompt }] : prompt
        const result = await model.doGenerate({ prompt: messages, tools })

        return {
          text: result.text,
          usage: {
            promptTokens: result.usage.inputTokens,
            completionTokens: result.usage.outputTokens,
            totalTokens: result.usage.inputTokens + result.usage.outputTokens,
          },
        }
      })

      const result = await generateText({
        model: model,
        prompt: 'What is the weather like?',
        tools: tools as any,
      })

      expect(result.text).toBe('I will use the weather tool')

      // Verify PostHog was called with tools
      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

      // Verify $ai_lib and $ai_lib_version
      expect(captureCall[0].properties['$ai_lib']).toBe('posthog-ai')
      expect(captureCall[0].properties['$ai_lib_version']).toBe(version)

      expect(captureCall[0].properties).toEqual(
        expect.objectContaining({
          $ai_trace_id: 'test-tools',
          $ai_model: 'gpt-4',
          $ai_provider: 'openai',
          $ai_tools: tools, // Verify tools are included
          $ai_input_tokens: 15,
          $ai_output_tokens: 5,
        })
      )
    })
  })

  describe('streamText with tool calls', () => {
    // Helper function to create a mock streaming model
    const createMockStreamingModel = (streamParts: LanguageModelV2StreamPart[]): LanguageModelV2 => {
      return {
        specificationVersion: 'v2' as const,
        provider: 'test-provider',
        modelId: 'test-streaming-model',
        supportedUrls: {},
        doGenerate: jest.fn(),
        doStream: jest.fn().mockImplementation(async () => {
          // Create a readable stream from the parts
          const stream = new ReadableStream<LanguageModelV2StreamPart>({
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
      } as LanguageModelV2
    }

    it('should capture single tool call in streaming', async () => {
      const streamParts: LanguageModelV2StreamPart[] = [
        { type: 'text-delta', id: 'text-1', delta: 'Let me check the weather ' },
        { type: 'tool-input-start', id: 'tc-1', toolName: 'get_weather' },
        { type: 'tool-input-delta', id: 'tc-1', delta: '{"location":"' },
        { type: 'tool-input-delta', id: 'tc-1', delta: 'San Francisco"}' },
        { type: 'tool-input-end', id: 'tc-1' },
        { type: 'text-delta', id: 'text-2', delta: 'for you.' },
        {
          type: 'finish',
          usage: { inputTokens: 20, outputTokens: 15, totalTokens: 35 },
          finishReason: 'stop',
        },
      ]

      const baseModel = createMockStreamingModel(streamParts)
      const model = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test-stream-tool',
      })

      // Process the stream - need to mock doStream on the wrapped model
      ;(model as any).doStream = async (params: any) => {
        const middleware = (wrapLanguageModel as jest.Mock).mock.calls[0][0].middleware
        return middleware.wrapStream({
          doStream: async () => baseModel.doStream(params),
          params,
          model: baseModel,
        })
      }

      const result = await model.doStream({
        prompt: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'What is the weather?' }] }],
      })

      // Read through the stream to trigger the transform and flush
      const reader = result.stream.getReader()
      while (!(await reader.read()).done) {
        // Continue reading
      }

      // Wait for any async operations to complete
      await flushPromises()

      // Verify PostHog was called
      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

      expect(captureCall[0].properties.$ai_output_choices).toEqual([
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check the weather for you.' },
            {
              type: 'tool-call',
              id: 'tc-1',
              function: {
                name: 'get_weather',
                arguments: '{"location":"San Francisco"}',
              },
            },
          ],
        },
      ])
    })

    it('should capture multiple tool calls in streaming', async () => {
      const streamParts: LanguageModelV2StreamPart[] = [
        { type: 'text-delta', id: 'text-1', delta: 'I will help you with multiple tasks. ' },
        // First tool call
        { type: 'tool-input-start', id: 'tc-1', toolName: 'get_weather' },
        { type: 'tool-input-delta', id: 'tc-1', delta: '{"location":"NYC"}' },
        { type: 'tool-input-end', id: 'tc-1' },
        // Second tool call
        { type: 'tool-input-start', id: 'tc-2', toolName: 'web_search' },
        { type: 'tool-input-delta', id: 'tc-2', delta: '{"query":"' },
        { type: 'tool-input-delta', id: 'tc-2', delta: 'latest news"}' },
        { type: 'tool-input-end', id: 'tc-2' },
        {
          type: 'finish',
          usage: { inputTokens: 30, outputTokens: 25, totalTokens: 55 },
          finishReason: 'stop',
        },
      ]

      const baseModel = createMockStreamingModel(streamParts)
      const model = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test-multi-tools',
      })

      // Process the stream - need to mock doStream on the wrapped model
      ;(model as any).doStream = async (params: any) => {
        const middleware = (wrapLanguageModel as jest.Mock).mock.calls[0][0].middleware
        return middleware.wrapStream({
          doStream: async () => baseModel.doStream(params),
          params,
          model: baseModel,
        })
      }

      const result = await model.doStream({
        prompt: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Check weather and news' }] }],
      })

      const reader = result.stream.getReader()
      while (!(await reader.read()).done) {
        // Continue reading
      }

      await flushPromises()

      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

      expect(captureCall[0].properties.$ai_output_choices).toEqual([
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will help you with multiple tasks. ' },
            {
              type: 'tool-call',
              id: 'tc-1',
              function: {
                name: 'get_weather',
                arguments: '{"location":"NYC"}',
              },
            },
            {
              type: 'tool-call',
              id: 'tc-2',
              function: {
                name: 'web_search',
                arguments: '{"query":"latest news"}',
              },
            },
          ],
        },
      ])
    })

    it('should handle direct tool-call chunks in streaming', async () => {
      const streamParts: LanguageModelV2StreamPart[] = [
        { type: 'text-delta', id: 'text-1', delta: 'Processing your request. ' },
        // Direct tool-call chunk (complete tool call in one chunk)
        {
          type: 'tool-call',
          toolCallId: 'tc-direct',
          toolName: 'calculate',
          input: '{"operation":"add","a":5,"b":3}',
        },
        {
          type: 'finish',
          usage: { inputTokens: 15, outputTokens: 10, totalTokens: 25 },
          finishReason: 'stop',
        },
      ]

      const baseModel = createMockStreamingModel(streamParts)
      const model = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test-direct-tool',
      })

      // Process the stream - need to mock doStream on the wrapped model
      ;(model as any).doStream = async (params: any) => {
        const middleware = (wrapLanguageModel as jest.Mock).mock.calls[0][0].middleware
        return middleware.wrapStream({
          doStream: async () => baseModel.doStream(params),
          params,
          model: baseModel,
        })
      }

      const result = await model.doStream({
        prompt: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Calculate 5 + 3' }] }],
      })

      const reader = result.stream.getReader()
      while (!(await reader.read()).done) {
        // Continue reading
      }

      await flushPromises()

      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

      expect(captureCall[0].properties.$ai_output_choices).toEqual([
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Processing your request. ' },
            {
              type: 'tool-call',
              id: 'tc-direct',
              function: {
                name: 'calculate',
                arguments: '{"operation":"add","a":5,"b":3}',
              },
            },
          ],
        },
      ])
    })

    it('should handle mixed content with text, reasoning, and tool calls', async () => {
      const streamParts: LanguageModelV2StreamPart[] = [
        { type: 'reasoning-delta', id: 'reasoning-1', delta: 'User wants weather info. ' },
        { type: 'reasoning-delta', id: 'reasoning-1', delta: 'I should use the weather tool.' },
        { type: 'text-delta', id: 'text-1', delta: 'Let me check that for you. ' },
        { type: 'tool-input-start', id: 'tc-1', toolName: 'get_weather' },
        { type: 'tool-input-delta', id: 'tc-1', delta: '{"location":"London","units":"celsius"}' },
        { type: 'tool-input-end', id: 'tc-1' },
        {
          type: 'finish',
          usage: {
            inputTokens: 25,
            outputTokens: 20,
            totalTokens: 45,
            reasoningTokens: 10,
          },
          finishReason: 'stop',
        },
      ]

      const baseModel = createMockStreamingModel(streamParts)
      const model = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test-mixed-content',
      })

      // Process the stream - need to mock doStream on the wrapped model
      ;(model as any).doStream = async (params: any) => {
        const middleware = (wrapLanguageModel as jest.Mock).mock.calls[0][0].middleware
        return middleware.wrapStream({
          doStream: async () => baseModel.doStream(params),
          params,
          model: baseModel,
        })
      }

      const result = await model.doStream({
        prompt: [
          { role: 'user' as const, content: [{ type: 'text' as const, text: 'What is the weather in London?' }] },
        ],
      })

      const reader = result.stream.getReader()
      while (!(await reader.read()).done) {
        // Continue reading
      }

      await flushPromises()

      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

      expect(captureCall[0].properties.$ai_output_choices).toEqual([
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'User wants weather info. I should use the weather tool.' },
            { type: 'text', text: 'Let me check that for you. ' },
            {
              type: 'tool-call',
              id: 'tc-1',
              function: {
                name: 'get_weather',
                arguments: '{"location":"London","units":"celsius"}',
              },
            },
          ],
        },
      ])

      // Also verify reasoning tokens are captured
      expect(captureCall[0].properties.$ai_reasoning_tokens).toBe(10)
    })

    it('should handle empty or incomplete tool calls gracefully', async () => {
      const streamParts: LanguageModelV2StreamPart[] = [
        { type: 'text-delta', id: 'text-1', delta: 'Here is the response. ' },
        // Tool call without arguments
        { type: 'tool-input-start', id: 'tc-1', toolName: 'empty_tool' },
        { type: 'tool-input-end', id: 'tc-1' },
        // Tool call with incomplete data (no name)
        {
          type: 'tool-call',
          toolCallId: 'tc-incomplete',
          toolName: '',
          input: '{"data":"test"}',
        },
        {
          type: 'finish',
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          finishReason: 'stop',
        },
      ]

      const baseModel = createMockStreamingModel(streamParts)
      const model = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test-empty-tools',
      })

      // Process the stream - need to mock doStream on the wrapped model
      ;(model as any).doStream = async (params: any) => {
        const middleware = (wrapLanguageModel as jest.Mock).mock.calls[0][0].middleware
        return middleware.wrapStream({
          doStream: async () => baseModel.doStream(params),
          params,
          model: baseModel,
        })
      }

      const result = await model.doStream({
        prompt: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Test empty tools' }] }],
      })

      const reader = result.stream.getReader()
      while (!(await reader.read()).done) {
        // Continue reading
      }

      await flushPromises()

      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

      // Should only include valid tool calls (tc-1 with empty_tool name)
      expect(captureCall[0].properties.$ai_output_choices).toEqual([
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Here is the response. ' },
            {
              type: 'tool-call',
              id: 'tc-1',
              function: {
                name: 'empty_tool',
                arguments: '',
              },
            },
          ],
        },
      ])
    })

    it('should handle streaming with only tool calls and no text', async () => {
      const streamParts: LanguageModelV2StreamPart[] = [
        { type: 'tool-input-start', id: 'tc-1', toolName: 'function_a' },
        { type: 'tool-input-delta', id: 'tc-1', delta: '{"param":"value"}' },
        { type: 'tool-input-end', id: 'tc-1' },
        {
          type: 'tool-call',
          toolCallId: 'tc-2',
          toolName: 'function_b',
          input: '{"x":10}',
        },
        {
          type: 'finish',
          usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
          finishReason: 'stop',
        },
      ]

      const baseModel = createMockStreamingModel(streamParts)
      const model = withTracing(baseModel, mockPostHogClient, {
        posthogDistinctId: 'test-user',
        posthogTraceId: 'test-tools-only',
      })

      // Process the stream - need to mock doStream on the wrapped model
      ;(model as any).doStream = async (params: any) => {
        const middleware = (wrapLanguageModel as jest.Mock).mock.calls[0][0].middleware
        return middleware.wrapStream({
          doStream: async () => baseModel.doStream(params),
          params,
          model: baseModel,
        })
      }

      const result = await model.doStream({
        prompt: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Execute functions' }] }],
      })

      const reader = result.stream.getReader()
      while (!(await reader.read()).done) {
        // Continue reading
      }

      await flushPromises()

      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

      expect(captureCall[0].properties.$ai_output_choices).toEqual([
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              id: 'tc-1',
              function: {
                name: 'function_a',
                arguments: '{"param":"value"}',
              },
            },
            {
              type: 'tool-call',
              id: 'tc-2',
              function: {
                name: 'function_b',
                arguments: '{"x":10}',
              },
            },
          ],
        },
      ])
    })
  })
})
