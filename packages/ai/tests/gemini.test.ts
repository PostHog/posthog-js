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

})
