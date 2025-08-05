import { PostHog } from 'posthog-node'
import { withTracing } from '../src/vercel'
import { MockLanguageModelV2 } from 'ai/test'
import { generateText, streamText } from 'ai'

let mockPostHogClient: PostHog
let mockModel: MockLanguageModelV2

jest.mock('posthog-node', () => ({
  PostHog: jest.fn().mockImplementation(() => ({
    capture: jest.fn(),
    captureImmediate: jest.fn(),
  })),
}))

describe('withTracing – AI SDK v5 Provider Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPostHogClient = new (PostHog as any)()
    mockModel = new MockLanguageModelV2({
      doGenerate: async () => ({
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        content: [{ type: 'text', text: 'Hello from Vercel AI SDK v5!' }],
        warnings: [],
      }),
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ id: 'idk', type: 'text-delta', delta: 'Hello' })
            controller.enqueue({ id: 'idk', type: 'text-delta', delta: ' from' })
            controller.enqueue({ id: 'idk', type: 'text-delta', delta: ' Vercel' })
            controller.enqueue({ id: 'idk', type: 'text-delta', delta: ' AI' })
            controller.enqueue({ id: 'idk', type: 'text-delta', delta: ' SDK' })
            controller.enqueue({ id: 'idk', type: 'text-delta', delta: ' v5!' })
            controller.enqueue({
              type: 'finish',
              finishReason: 'stop',
              usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            })
            controller.close()
          },
        }),
      }),
    })
  })

  it('should wrap and instrument a Vercel AI SDK v5 model for generateText', async () => {
    const wrapped = withTracing(mockModel, mockPostHogClient, {
      posthogDistinctId: 'user-123',
      posthogProperties: { foo: 'bar' },
    })

    const result = await generateText({
      model: wrapped,
      prompt: 'Hi',
    })

    expect(result.text).toBe('Hello from Vercel AI SDK v5!')
    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
  })

  it('should wrap and instrument a Vercel AI SDK v5 model for streamText', async () => {
    const wrapped = withTracing(mockModel, mockPostHogClient, {
      posthogDistinctId: 'user-456',
      posthogTraceId: 'trace-xyz',
    })

    const { textStream } = streamText({
      model: wrapped,
      prompt: 'Hi',
    })

    let fullText = ''
    for await (const chunk of textStream) {
      fullText += chunk
    }

    expect(fullText).toBe('Hello from Vercel AI SDK v5!')
    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
  })

  it('should handle privacy mode correctly', async () => {
    const wrapped = withTracing(mockModel, mockPostHogClient, {
      posthogDistinctId: 'user-789',
      posthogPrivacyMode: true,
    })

    await generateText({
      model: wrapped,
      prompt: 'Sensitive prompt',
    })

    const [call] = (mockPostHogClient.capture as jest.Mock).mock.calls[0]
    expect(call.properties['$ai_input']).toBeNull()
  })

  it('should use captureImmediate when flag is set', async () => {
    const wrapped = withTracing(mockModel, mockPostHogClient, {
      posthogDistinctId: 'user-012',
      posthogCaptureImmediate: true,
    })

    await generateText({
      model: wrapped,
      prompt: 'Hi',
    })

    expect(mockPostHogClient.captureImmediate).toHaveBeenCalledTimes(1)
    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(0)
  })

  it('should handle anonymous user correctly', async () => {
    const wrapped = withTracing(mockModel, mockPostHogClient, {
      posthogTraceId: 'trace-anon',
    })

    await generateText({
      model: wrapped,
      prompt: 'Hi',
    })

    const [call] = (mockPostHogClient.capture as jest.Mock).mock.calls[0]
    expect(call.distinctId).toBe('trace-anon')
    expect(call.properties['$process_person_profile']).toBe(false)
  })
})
