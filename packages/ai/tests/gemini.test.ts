import { PostHog } from 'posthog-node'
import PostHogGemini from '../src/gemini'
import { version } from '../package.json'

let mockGeminiResponse: any = {}
let mockGeminiStreamResponse: any = {}

jest.mock('posthog-node', () => {
  return {
    PostHog: jest.fn().mockImplementation(() => {
      return {
        capture: jest.fn(),
        captureImmediate: jest.fn(),
        privacyMode: false,
      }
    }),
  }
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

  return {
    GoogleGenAI: MockGoogleGenAI,
  }
})

// Helper function to mock generateContentStream with provided chunks
const mockGenerateContentStream = (chunks: any[]) => {
  return jest.fn().mockImplementation(() => {
    return (async function* () {
      for (const chunk of chunks) {
        yield chunk
      }
    })()
  })
}

describe('PostHogGemini - Jest test suite', () => {
  let mockPostHogClient: PostHog
  let client: PostHogGemini

  beforeEach(() => {
    jest.clearAllMocks()

    // Reset the default mocks
    mockPostHogClient = new (PostHog as any)()
    client = new PostHogGemini({
      apiKey: 'test-api-key',
      posthog: mockPostHogClient as any,
    })

    // Some default generate content mock
    mockGeminiResponse = {
      text: 'Hello from Gemini!',
      candidates: [
        {
          content: {
            parts: [
              {
                text: 'Hello from Gemini!',
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 15,
        candidatesTokenCount: 8,
        totalTokenCount: 23,
      },
    }

    // Mock streaming response
    mockGeminiStreamResponse = [
      {
        text: 'Hello ',
        candidates: [
          {
            content: {
              parts: [{ text: 'Hello ' }],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 15,
          candidatesTokenCount: 2,
        },
      },
      {
        text: 'from ',
        candidates: [
          {
            content: {
              parts: [{ text: 'from ' }],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 15,
          candidatesTokenCount: 4,
        },
      },
      {
        text: 'Gemini!',
        candidates: [
          {
            content: {
              parts: [{ text: 'Gemini!' }],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 15,
          candidatesTokenCount: 8,
        },
      },
    ]

    // Mock the generateContent method
    ;(client as any).client.models.generateContent = jest.fn().mockResolvedValue(mockGeminiResponse)

    // Mock the generateContentStream method
    ;(client as any).client.models.generateContentStream = mockGenerateContentStream(mockGeminiStreamResponse)
  })

  test('basic content generation', async () => {
    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash-001',
      contents: 'Hello',
      posthogDistinctId: 'test-id',
      posthogProperties: { foo: 'bar' },
    })

    expect(response).toEqual(mockGeminiResponse)
    // We expect 1 capture call
    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    // Check the capture arguments
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { distinctId, event, properties } = captureArgs[0]

    expect(distinctId).toBe('test-id')
    expect(event).toBe('$ai_generation')
    expect(properties['$ai_lib']).toBe('posthog-ai')
    expect(properties['$ai_lib_version']).toBe(version)
    expect(properties['$ai_provider']).toBe('gemini')
    expect(properties['$ai_model']).toBe('gemini-2.0-flash-001')
    expect(properties['$ai_input']).toEqual([{ role: 'user', content: 'Hello' }])
    expect(properties['$ai_output_choices']).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello from Gemini!' }],
      },
    ])
    expect(properties['$ai_input_tokens']).toBe(15)
    expect(properties['$ai_output_tokens']).toBe(8)
    expect(properties['$ai_http_status']).toBe(200)
    expect(properties['foo']).toBe('bar')
    expect(typeof properties['$ai_latency']).toBe('number')
  })

  test('streaming content generation', async () => {
    const stream = client.models.generateContentStream({
      model: 'gemini-2.0-flash-001',
      contents: 'Write a short poem',
      posthogDistinctId: 'test-id',
      posthogProperties: { foo: 'bar' },
    })

    let accumulatedText = ''
    for await (const chunk of stream) {
      if (chunk.text) {
        accumulatedText += chunk.text
      }
    }

    expect(accumulatedText).toBe('Hello from Gemini!')
    // We expect 1 capture call after streaming completes
    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)

    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { distinctId, event, properties } = captureArgs[0]

    expect(distinctId).toBe('test-id')
    expect(event).toBe('$ai_generation')
    expect(properties['$ai_lib']).toBe('posthog-ai')
    expect(properties['$ai_lib_version']).toBe(version)
    expect(properties['$ai_provider']).toBe('gemini')
    expect(properties['$ai_model']).toBe('gemini-2.0-flash-001')
    expect(properties['$ai_input']).toEqual([{ role: 'user', content: 'Write a short poem' }])
    expect(properties['$ai_output_choices']).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello from Gemini!' }],
      },
    ])
    expect(properties['$ai_input_tokens']).toBe(15)
    expect(properties['$ai_output_tokens']).toBe(8)
    expect(properties['$ai_http_status']).toBe(200)
    expect(properties['foo']).toBe('bar')
    expect(typeof properties['$ai_latency']).toBe('number')
  })

  test('groups', async () => {
    await client.models.generateContent({
      model: 'gemini-2.0-flash-001',
      contents: 'Hello',
      posthogDistinctId: 'test-id',
      posthogGroups: { team: 'ai-team' },
    })

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { groups } = captureArgs[0]

    expect(groups).toEqual({ team: 'ai-team' })
  })

  test('privacy mode', async () => {
    await client.models.generateContent({
      model: 'gemini-2.0-flash-001',
      contents: 'Sensitive information',
      posthogDistinctId: 'test-id',
      posthogPrivacyMode: true,
    })

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { properties } = captureArgs[0]

    expect(properties['$ai_input']).toBeNull()
    expect(properties['$ai_output_choices']).toBeNull()
  })

  test('error handling', async () => {
    const error = new Error('API Error')
    ;(error as any).status = 400
    ;(client as any).client.models.generateContent = jest.fn().mockRejectedValue(error)

    await expect(
      client.models.generateContent({
        model: 'gemini-2.0-flash-001',
        contents: 'Hello',
        posthogDistinctId: 'test-id',
      })
    ).rejects.toThrow('API Error')

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { properties } = captureArgs[0]

    expect(properties['$ai_is_error']).toBe(true)
    expect(properties['$ai_http_status']).toBe(400)
    expect(properties['$ai_input_tokens']).toBe(0)
    expect(properties['$ai_output_tokens']).toBe(0)
  })

  test('array contents input', async () => {
    await client.models.generateContent({
      model: 'gemini-2.0-flash-001',
      contents: ['Hello', 'How are you?'],
      posthogDistinctId: 'test-id',
    })

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { properties } = captureArgs[0]

    expect(properties['$ai_input']).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'user', content: 'How are you?' },
    ])
  })

  test('object contents input', async () => {
    await client.models.generateContent({
      model: 'gemini-2.0-flash-001',
      contents: { text: 'Hello world' },
      posthogDistinctId: 'test-id',
    })

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { properties } = captureArgs[0]

    expect(properties['$ai_input']).toEqual([{ role: 'user', content: 'Hello world' }])
  })

  test('capture immediate', async () => {
    await client.models.generateContent({
      model: 'gemini-2.0-flash-001',
      contents: 'Hello',
      posthogDistinctId: 'test-id',
      posthogCaptureImmediate: true,
    })

    expect(mockPostHogClient.captureImmediate).toHaveBeenCalledTimes(1)
    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(0)
  })

  test('vertex ai configuration', () => {
    const vertexClient = new PostHogGemini({
      vertexai: true,
      project: 'test-project',
      location: 'us-central1',
      posthog: mockPostHogClient as any,
    })

    expect(vertexClient).toBeInstanceOf(PostHogGemini)
    expect(vertexClient.models).toBeDefined()
  })

  test('streaming tracks time to first token', async () => {
    const stream = client.models.generateContentStream({
      model: 'gemini-2.0-flash-001',
      contents: 'Write a short poem',
      posthogDistinctId: 'test-ttft-user',
    })

    for await (const _chunk of stream) {
      // Just consume the stream
    }

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { properties } = captureArgs[0]

    // Time to first token should be present and be a number
    expect(typeof properties['$ai_time_to_first_token']).toBe('number')
    expect(properties['$ai_time_to_first_token']).toBeGreaterThanOrEqual(0)
    // Time to first token should be less than or equal to total latency
    expect(properties['$ai_time_to_first_token']).toBeLessThanOrEqual(properties['$ai_latency'])
  })

  test('streaming with function calls', async () => {
    // Mock streaming response with function calls
    const mockStreamWithFunctions = [
      {
        text: 'I can help with that. ',
        candidates: [
          {
            content: {
              parts: [{ text: 'I can help with that. ' }],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 20,
          candidatesTokenCount: 5,
        },
      },
      {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'searchWeather',
                    args: { location: 'New York', units: 'celsius' },
                  },
                },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 20,
          candidatesTokenCount: 10,
        },
      },
      {
        text: 'The weather is sunny.',
        candidates: [
          {
            content: {
              parts: [{ text: 'The weather is sunny.' }],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 20,
          candidatesTokenCount: 15,
        },
      },
    ]

    // Update mock to use function call stream
    ;(client as any).client.models.generateContentStream = mockGenerateContentStream(mockStreamWithFunctions)

    const stream = client.models.generateContentStream({
      model: 'gemini-2.0-flash-001',
      contents: 'What is the weather?',
      posthogDistinctId: 'test-id',
    })

    let accumulatedText = ''
    const functionCalls: any[] = []

    for await (const chunk of stream) {
      if (chunk.text) {
        accumulatedText += chunk.text
      }
      if (chunk.candidates) {
        for (const candidate of chunk.candidates) {
          if (candidate.content?.parts) {
            for (const part of candidate.content.parts) {
              if ('functionCall' in part) {
                functionCalls.push(part.functionCall)
              }
            }
          }
        }
      }
    }

    expect(accumulatedText).toBe('I can help with that. The weather is sunny.')
    expect(functionCalls).toHaveLength(1)
    expect(functionCalls[0]).toEqual({
      name: 'searchWeather',
      args: { location: 'New York', units: 'celsius' },
    })

    // Check PostHog capture
    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { properties } = captureArgs[0]

    expect(properties['$ai_output_choices']).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I can help with that. The weather is sunny.' },
          {
            type: 'function',
            function: {
              name: 'searchWeather',
              arguments: { location: 'New York', units: 'celsius' },
            },
          },
        ],
      },
    ])
    expect(properties['$ai_input_tokens']).toBe(20)
    expect(properties['$ai_output_tokens']).toBe(15)
  })

  test('streaming with multiple text chunks accumulation', async () => {
    // Mock streaming response with multiple text chunks
    const mockMultipleTextChunks = [
      {
        text: 'The ',
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 },
      },
      {
        text: 'quick ',
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
      },
      {
        text: 'brown ',
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 },
      },
      {
        text: 'fox.',
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4 },
      },
    ]

    // Update mock
    ;(client as any).client.models.generateContentStream = mockGenerateContentStream(mockMultipleTextChunks)

    const stream = client.models.generateContentStream({
      model: 'gemini-2.0-flash-001',
      contents: 'Tell me a story',
      posthogDistinctId: 'test-id',
    })

    let accumulatedText = ''
    for await (const chunk of stream) {
      if (chunk.text) {
        accumulatedText += chunk.text
      }
    }

    expect(accumulatedText).toBe('The quick brown fox.')

    // Check PostHog capture for proper text accumulation
    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { properties } = captureArgs[0]

    // Should have a single text item with all accumulated text
    expect(properties['$ai_output_choices']).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'The quick brown fox.' }],
      },
    ])
    expect(properties['$ai_output_tokens']).toBe(4)
  })

  test('anonymous user - $process_person_profile set to false', async () => {
    await client.models.generateContent({
      model: 'gemini-2.0-flash-001',
      contents: 'Hello',
      posthogTraceId: 'trace-123',
    })

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { distinctId, properties } = captureArgs[0]

    expect(distinctId).toBe('trace-123')
    expect(properties['$process_person_profile']).toBe(false)
  })

  test('identified user - $process_person_profile not set', async () => {
    await client.models.generateContent({
      model: 'gemini-2.0-flash-001',
      contents: 'Hello',
      posthogDistinctId: 'user-456',
      posthogTraceId: 'trace-123',
    })

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { distinctId, properties } = captureArgs[0]

    expect(distinctId).toBe('user-456')
    expect(properties['$process_person_profile']).toBeUndefined()
  })

  test('systemInstruction parameter as string', async () => {
    await client.models.generateContent({
      model: 'gemini-2.0-flash-001',
      contents: 'What is the weather?',
      config: { systemInstruction: 'You are a helpful weather assistant.' },
      posthogDistinctId: 'test-system-instruction',
    })

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { distinctId, properties } = captureArgs[0]

    expect(distinctId).toBe('test-system-instruction')
    expect(properties['$ai_input']).toEqual([
      { role: 'system', content: 'You are a helpful weather assistant.' },
      { role: 'user', content: 'What is the weather?' },
    ])
  })

  test('systemInstruction parameter as ContentUnion', async () => {
    await client.models.generateContent({
      model: 'gemini-2.0-flash-001',
      contents: 'What is the capital of France?',
      config: { systemInstruction: { parts: [{ text: 'You are a geography expert.' }] } },
      posthogDistinctId: 'test-systemInstruction',
    })

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { distinctId, properties } = captureArgs[0]

    expect(distinctId).toBe('test-systemInstruction')
    expect(properties['$ai_input']).toEqual([
      { role: 'system', content: 'You are a geography expert.' },
      { role: 'user', content: 'What is the capital of France?' },
    ])
  })

  test('streaming with systemInstruction parameter', async () => {
    const stream = client.models.generateContentStream({
      model: 'gemini-2.0-flash-001',
      contents: 'Tell me about AI',
      config: { systemInstruction: 'You are an AI expert.' },
      posthogDistinctId: 'test-stream-system',
    })

    for await (const _chunk of stream) {
      // Just consume the stream
    }

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { distinctId, properties } = captureArgs[0]

    expect(distinctId).toBe('test-stream-system')
    expect(properties['$ai_input']).toEqual([
      { role: 'system', content: 'You are an AI expert.' },
      { role: 'user', content: 'Tell me about AI' },
    ])
  })

  describe('Web Search Tracking', () => {
    test('should detect grounding metadata (binary detection)', async () => {
      mockGeminiResponse = {
        text: 'Based on search results, here is what I found.',
        candidates: [
          {
            content: {
              parts: [{ text: 'Based on search results, here is what I found.' }],
              role: 'model',
            },
            finishReason: 'STOP',
            index: 0,
            safetyRatings: [],
            groundingMetadata: {
              webSearchQueries: ['PostHog features'],
              groundingChunks: [
                {
                  web: {
                    uri: 'https://posthog.com',
                    title: 'PostHog',
                  },
                },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 25,
          candidatesTokenCount: 18,
          totalTokenCount: 43,
        },
      } as any

      // Update the mock to use the new response
      ;(client as any).client.models.generateContent = jest.fn().mockResolvedValue(mockGeminiResponse)

      await client.models.generateContent({
        model: 'gemini-2.0-flash-001',
        contents: 'What is PostHog?',
        posthogDistinctId: 'test-user',
      })

      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      // Gemini uses binary detection (1 or 0)
      expect(properties['$ai_web_search_count']).toBe(1)
    })

    test('should detect grounding in streaming', async () => {
      // Create mock stream with grounding metadata
      mockGeminiStreamResponse = [
        {
          text: 'Search result',
          candidates: [
            {
              content: {
                parts: [{ text: 'Search result' }],
                role: 'model',
              },
              groundingMetadata: {
                groundingChunks: [
                  {
                    web: {
                      uri: 'https://example.com',
                      title: 'Example',
                    },
                  },
                ],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 20,
            candidatesTokenCount: 10,
            totalTokenCount: 30,
          },
        },
      ] as any

      // Re-mock the generateContentStream method with new chunks
      ;(client as any).client.models.generateContentStream = mockGenerateContentStream(mockGeminiStreamResponse)

      const stream = client.models.generateContentStream({
        model: 'gemini-2.0-flash-001',
        contents: 'Search query',
        posthogDistinctId: 'test-user',
      })

      for await (const _chunk of stream) {
        // Just consume
      }

      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      expect(properties['$ai_web_search_count']).toBe(1)
    })

    test('should return 0 for empty grounding metadata', async () => {
      mockGeminiResponse = {
        text: 'Regular response',
        candidates: [
          {
            content: {
              parts: [{ text: 'Regular response' }],
              role: 'model',
            },
            finishReason: 'STOP',
            index: 0,
            safetyRatings: [],
            groundingMetadata: null, // Explicitly null
          },
        ],
        usageMetadata: {
          promptTokenCount: 15,
          candidatesTokenCount: 8,
          totalTokenCount: 23,
        },
      } as any

      await client.models.generateContent({
        model: 'gemini-2.0-flash-001',
        contents: 'Hello',
        posthogDistinctId: 'test-user',
      })

      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      // Should not include web search count when grounding not present
      expect(properties['$ai_web_search_count']).toBeUndefined()
    })

    test('should return 0 for empty grounding arrays', async () => {
      mockGeminiResponse = {
        text: 'Regular response',
        candidates: [
          {
            content: {
              parts: [{ text: 'Regular response' }],
              role: 'model',
            },
            finishReason: 'STOP',
            index: 0,
            safetyRatings: [],
            groundingMetadata: {
              webSearchQueries: [], // Empty array
              groundingChunks: [], // Empty array
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 12,
          candidatesTokenCount: 6,
          totalTokenCount: 18,
        },
      } as any

      await client.models.generateContent({
        model: 'gemini-2.0-flash-001',
        contents: 'Test',
        posthogDistinctId: 'test-user',
      })

      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      // Empty arrays should not trigger web search count
      expect(properties['$ai_web_search_count']).toBeUndefined()
    })

    test('should return 0 for empty grounding metadata object', async () => {
      mockGeminiResponse = {
        text: 'Hello! How can I help you today?',
        candidates: [
          {
            content: {
              parts: [{ text: 'Hello! How can I help you today?' }],
              role: 'model',
            },
            finishReason: 'STOP',
            groundingMetadata: {}, // Empty object - this was the bug!
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 2,
          candidatesTokenCount: 9,
          totalTokenCount: 43,
        },
      } as any

      await client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: 'hi',
        posthogDistinctId: 'test-user',
      })

      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      // Empty groundingMetadata object should not trigger web search count
      expect(properties['$ai_web_search_count']).toBeUndefined()
    })

    test('should detect google_search function call', async () => {
      mockGeminiResponse = {
        text: '',
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'google_search',
                    args: { query: 'PostHog documentation' },
                  },
                },
              ],
              role: 'model',
            },
            finishReason: 'STOP',
            index: 0,
            safetyRatings: [],
          },
        ],
        usageMetadata: {
          promptTokenCount: 30,
          candidatesTokenCount: 15,
          totalTokenCount: 45,
        },
      } as any

      // Update the mock to use the new response
      ;(client as any).client.models.generateContent = jest.fn().mockResolvedValue(mockGeminiResponse)

      await client.models.generateContent({
        model: 'gemini-2.0-flash-001',
        contents: 'Search for PostHog',
        posthogDistinctId: 'test-user',
      })

      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { properties } = captureArgs[0]

      // Function call with google_search should trigger web search count
      expect(properties['$ai_web_search_count']).toBe(1)
    })
  })

  describe('TTS Support', () => {
    test('should support responseModalities and speechConfig in config', async () => {
      mockGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'audio/wav',
                    data: Buffer.from('fake audio data').toString('base64'),
                  },
                },
              ],
              role: 'model',
            },
            finishReason: 'STOP',
            index: 0,
            safetyRatings: [],
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 0,
          totalTokenCount: 10,
        },
      } as any
      ;(client as any).client.models.generateContent = jest.fn().mockResolvedValue(mockGeminiResponse)

      await client.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{ role: 'user', parts: [{ text: 'Say hello' }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Kore',
              },
            },
          },
        },
        posthogDistinctId: 'test-tts-user',
      })

      expect(mockPostHogClient.capture).toHaveBeenCalled()
      const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
      const { distinctId, properties } = captureArgs[0]

      expect(distinctId).toBe('test-tts-user')
      expect(properties['$ai_model']).toBe('gemini-2.5-flash-preview-tts')
      expect(properties['$ai_input']).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Say hello' }] }])

      const generateContentCall = ((client as any).client.models.generateContent as jest.Mock).mock.calls[0][0]
      expect(generateContentCall.config.responseModalities).toEqual(['AUDIO'])
      expect(generateContentCall.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore')
    })
  })
})
