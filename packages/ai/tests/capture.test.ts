import { captureAiGeneration } from '../src/capture'
import { PostHog } from 'posthog-node'

jest.mock('posthog-node')

describe('captureAiGeneration', () => {
  let mockClient: jest.Mocked<PostHog>

  beforeEach(() => {
    mockClient = {
      capture: jest.fn(),
      captureImmediate: jest.fn(),
      options: {
        enableExceptionAutocapture: false,
      },
      captureException: jest.fn(),
    } as unknown as jest.Mocked<PostHog>
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should capture a standard ai generation event', async () => {
    await captureAiGeneration(mockClient, {
      distinctId: 'user-123',
      traceId: 'trace-abc',
      provider: 'cloudflare-workers-ai',
      model: '@cf/zai-org/glm-4.7-flash',
      input: 'tell me a joke',
      output: 'why did the chicken cross the road? to get to the other side.',
      usage: { inputTokens: 10, outputTokens: 15 },
      latency: 1.5,
      properties: { feature: 'test-feature' },
    })

    expect(mockClient.capture).toHaveBeenCalledTimes(1)
    expect(mockClient.capture).toHaveBeenCalledWith({
      distinctId: 'user-123',
      event: '$ai_generation',
      properties: expect.objectContaining({
        $ai_provider: 'cloudflare-workers-ai',
        $ai_model: '@cf/zai-org/glm-4.7-flash',
        $ai_input: 'tell me a joke',
        $ai_output_choices: 'why did the chicken cross the road? to get to the other side.',
        $ai_input_tokens: 10,
        $ai_output_tokens: 15,
        $ai_latency: 1.5,
        $ai_trace_id: 'trace-abc',
        feature: 'test-feature',
        $ai_tokens_source: 'sdk',
      }),
      groups: undefined,
    })
  })

  it('should generate a traceId if not provided', async () => {
    await captureAiGeneration(mockClient, {
      distinctId: 'user-123',
    })

    expect(mockClient.capture).toHaveBeenCalledTimes(1)
    expect(mockClient.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          $ai_trace_id: expect.any(String),
        }),
      })
    )
  })

  it('should fallback to distinctId as traceId for distinctId param if traceId is missing', async () => {
     await captureAiGeneration(mockClient, {
      traceId: 'trace-123',
    })

    expect(mockClient.capture).toHaveBeenCalledTimes(1)
    expect(mockClient.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: 'trace-123',
      })
    )
  })

  it('should capture immediate when captureImmediate is true', async () => {
    await captureAiGeneration(mockClient, {
      distinctId: 'user-123',
      captureImmediate: true,
    })

    expect(mockClient.captureImmediate).toHaveBeenCalledTimes(1)
    expect(mockClient.capture).not.toHaveBeenCalled()
  })

  it('should capture an error event correctly', async () => {
    const error = new Error('Test error')
    await captureAiGeneration(mockClient, {
      distinctId: 'user-123',
      error,
    })

    expect(mockClient.capture).toHaveBeenCalledTimes(1)
    expect(mockClient.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          $ai_is_error: true,
          $ai_error: JSON.stringify(error),
        }),
      })
    )
  })

  it('should redact input and output when privacyMode is true', async () => {
    await captureAiGeneration(mockClient, {
      distinctId: 'user-123',
      input: 'secret input',
      output: 'secret output',
      privacyMode: true,
    })

    expect(mockClient.capture).toHaveBeenCalledTimes(1)
    expect(mockClient.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          $ai_input: null,
          $ai_output_choices: null,
        }),
      })
    )
  })
})
