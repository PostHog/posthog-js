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

  const testError = new Error('Test error')

  it.each([
    [
      'should capture a standard ai generation event',
      {
        distinctId: 'user-123',
        traceId: 'trace-abc',
        provider: 'cloudflare-workers-ai',
        model: '@cf/zai-org/glm-4.7-flash',
        input: 'tell me a joke',
        output: 'why did the chicken cross the road? to get to the other side.',
        usage: { inputTokens: 10, outputTokens: 15 },
        latency: 1.5,
        properties: { feature: 'test-feature' },
      },
      {
        captureTimes: 1,
        captureImmediateTimes: 0,
        expectedArgs: {
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
        },
      },
    ],
    [
      'should generate a traceId if not provided',
      {
        distinctId: 'user-123',
      },
      {
        captureTimes: 1,
        captureImmediateTimes: 0,
        expectedArgs: expect.objectContaining({
          properties: expect.objectContaining({
            $ai_trace_id: expect.any(String),
          }),
        }),
      },
    ],
    [
      'should use traceId as distinctId when distinctId is not provided',
      {
        traceId: 'trace-123',
      },
      {
        captureTimes: 1,
        captureImmediateTimes: 0,
        expectedArgs: expect.objectContaining({
          distinctId: 'trace-123',
        }),
      },
    ],
    [
      'should capture immediate when captureImmediate is true',
      {
        distinctId: 'user-123',
        captureImmediate: true,
      },
      {
        captureTimes: 0,
        captureImmediateTimes: 1,
      },
    ],
    [
      'should capture an error event correctly',
      {
        distinctId: 'user-123',
        error: testError,
      },
      {
        captureTimes: 1,
        captureImmediateTimes: 0,
        expectedArgs: expect.objectContaining({
          properties: expect.objectContaining({
            $ai_is_error: true,
            $ai_error: JSON.stringify(testError),
          }),
        }),
      },
    ],
    [
      'should redact input and output when privacyMode is true',
      {
        distinctId: 'user-123',
        input: 'secret input',
        output: 'secret output',
        privacyMode: true,
      },
      {
        captureTimes: 1,
        captureImmediateTimes: 0,
        expectedArgs: expect.objectContaining({
          properties: expect.objectContaining({
            $ai_input: null,
            $ai_output_choices: null,
          }),
        }),
      },
    ],
  ])('%s', async (description, options, expected) => {
    await captureAiGeneration(mockClient, options)

    expect(mockClient.capture).toHaveBeenCalledTimes(expected.captureTimes)
    expect(mockClient.captureImmediate).toHaveBeenCalledTimes(expected.captureImmediateTimes)

    if (expected.captureTimes > 0 && expected.expectedArgs) {
      expect(mockClient.capture).toHaveBeenCalledWith(expected.expectedArgs)
    }
  })
})
