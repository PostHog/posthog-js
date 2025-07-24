import { PostHog } from 'posthog-node'
import PostHogGemini from '../src/gemini'

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

describe('PostHogGemini - Jest test suite', () => {
  let mockPostHogClient: PostHog
  let client: PostHogGemini

  beforeAll(() => {
    if (!process.env.GEMINI_API_KEY) {
      console.warn('⚠️ Skipping Gemini tests: No GEMINI_API_KEY environment variable set')
    }
  })

  beforeEach(() => {
    // Skip all tests if no API key is present
    if (!process.env.GEMINI_API_KEY) {
      return
    }

    jest.clearAllMocks()

    // Reset the default mocks
    mockPostHogClient = new (PostHog as any)()
    client = new PostHogGemini({
      apiKey: process.env.GEMINI_API_KEY || '',
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
    ;(client as any).client.models.generateContentStream = jest.fn().mockImplementation(async function* () {
      for (const chunk of mockGeminiStreamResponse) {
        yield chunk
      }
    })
  })

  // Wrap each test with conditional skip
  const conditionalTest = process.env.GEMINI_API_KEY ? test : test.skip

  conditionalTest('basic content generation', async () => {
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
    expect(properties['$ai_provider']).toBe('gemini')
    expect(properties['$ai_model']).toBe('gemini-2.0-flash-001')
    expect(properties['$ai_input']).toEqual([{ role: 'user', content: 'Hello' }])
    expect(properties['$ai_output_choices']).toEqual([{ role: 'assistant', content: 'Hello from Gemini!' }])
    expect(properties['$ai_input_tokens']).toBe(15)
    expect(properties['$ai_output_tokens']).toBe(8)
    expect(properties['$ai_http_status']).toBe(200)
    expect(properties['foo']).toBe('bar')
    expect(typeof properties['$ai_latency']).toBe('number')
  })

  conditionalTest('streaming content generation', async () => {
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
    expect(properties['$ai_provider']).toBe('gemini')
    expect(properties['$ai_model']).toBe('gemini-2.0-flash-001')
    expect(properties['$ai_input']).toEqual([{ role: 'user', content: 'Write a short poem' }])
    expect(properties['$ai_output_choices']).toEqual([{ content: 'Hello from Gemini!', role: 'assistant' }])
    expect(properties['$ai_input_tokens']).toBe(15)
    expect(properties['$ai_output_tokens']).toBe(8)
    expect(properties['$ai_http_status']).toBe(200)
    expect(properties['foo']).toBe('bar')
    expect(typeof properties['$ai_latency']).toBe('number')
  })

  conditionalTest('groups', async () => {
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

  conditionalTest('privacy mode', async () => {
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

  conditionalTest('error handling', async () => {
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

  conditionalTest('array contents input', async () => {
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

  conditionalTest('object contents input', async () => {
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

  conditionalTest('capture immediate', async () => {
    await client.models.generateContent({
      model: 'gemini-2.0-flash-001',
      contents: 'Hello',
      posthogDistinctId: 'test-id',
      posthogCaptureImmediate: true,
    })

    expect(mockPostHogClient.captureImmediate).toHaveBeenCalledTimes(1)
    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(0)
  })

  conditionalTest('vertex ai configuration', () => {
    const vertexClient = new PostHogGemini({
      vertexai: true,
      project: 'test-project',
      location: 'us-central1',
      posthog: mockPostHogClient as any,
    })

    expect(vertexClient).toBeInstanceOf(PostHogGemini)
    expect(vertexClient.models).toBeDefined()
  })

  conditionalTest('anonymous user - $process_person_profile set to false', async () => {
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

  conditionalTest('identified user - $process_person_profile not set', async () => {
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
