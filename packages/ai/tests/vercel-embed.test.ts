import { PostHog } from 'posthog-node'
import type { EmbeddingModelV2, EmbeddingModelV3 } from '@ai-sdk/provider'
import { embedManyWithTracing, embedWithTracing } from '../src/vercel'

vi.mock('posthog-node', () => {
  return {
    PostHog: vi.fn().mockImplementation(() => {
      return {
        capture: vi.fn(),
        captureImmediate: vi.fn(),
        privacy_mode: false,
      }
    }),
  }
})

const embedValues = async ({ values }: { values: string[] }) => ({
  embeddings: values.map((_, i) => [i, 0.5]),
  usage: { tokens: values.length * 3 },
  warnings: [],
})

const createMockV3EmbeddingModel = (): EmbeddingModelV3 => ({
  specificationVersion: 'v3',
  provider: 'openai.embedding',
  modelId: 'text-embedding-3-small',
  maxEmbeddingsPerCall: 100,
  supportsParallelCalls: true,
  doEmbed: vi.fn().mockImplementation(embedValues),
})

const createMockV2EmbeddingModel = (): EmbeddingModelV2<string> => ({
  specificationVersion: 'v2',
  provider: 'openai.embedding',
  modelId: 'text-embedding-3-small',
  maxEmbeddingsPerCall: 100,
  supportsParallelCalls: true,
  doEmbed: vi.fn().mockImplementation(embedValues),
})

describe('Vercel AI SDK embeddings', () => {
  let mockPostHogClient: PostHog

  beforeEach(() => {
    vi.clearAllMocks()
    mockPostHogClient = new (PostHog as any)()
  })

  const capturedEvent = () => {
    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    return (mockPostHogClient.capture as vi.Mock).mock.calls[0][0]
  }

  it('captures $ai_embedding for embed', async () => {
    const result = await embedWithTracing({
      model: createMockV3EmbeddingModel(),
      value: 'hello',
      posthog: mockPostHogClient,
      posthogDistinctId: 'test-user',
      posthogTraceId: 'trace-1',
      posthogProperties: { team: 'ai' },
    })

    expect(result.embedding).toEqual([0, 0.5])
    const { distinctId, event, properties } = capturedEvent()
    expect(distinctId).toBe('test-user')
    expect(event).toBe('$ai_embedding')
    expect(properties).toMatchObject({
      $ai_model: 'text-embedding-3-small',
      $ai_provider: 'openai',
      $ai_input: 'hello',
      $ai_input_tokens: 3,
      $ai_http_status: 200,
      $ai_trace_id: 'trace-1',
      $ai_framework: 'vercel',
      $ai_framework_version: '6',
      team: 'ai',
    })
    expect(typeof properties.$ai_latency).toBe('number')
  })

  it('captures $ai_embedding for embedMany with a V2 model', async () => {
    const result = await embedManyWithTracing({
      model: createMockV2EmbeddingModel(),
      values: ['a', 'b'],
      posthog: mockPostHogClient,
      posthogDistinctId: 'test-user',
    })

    expect(result.embeddings).toHaveLength(2)
    const { properties } = capturedEvent()
    expect(properties).toMatchObject({
      $ai_input: ['a', 'b'],
      $ai_input_tokens: 6,
      $ai_framework_version: '5',
    })
  })

  it('does not pass PostHog options to the model', async () => {
    const model = createMockV3EmbeddingModel()
    await embedWithTracing({ model, value: 'hello', posthog: mockPostHogClient, posthogDistinctId: 'test-user' })

    const callOptions = (model.doEmbed as vi.Mock).mock.calls[0][0]
    expect(Object.keys(callOptions).filter((key) => key.startsWith('posthog'))).toEqual([])
  })

  it('redacts input in privacy mode', async () => {
    await embedManyWithTracing({
      model: createMockV3EmbeddingModel(),
      values: ['secret'],
      posthog: mockPostHogClient,
      posthogPrivacyMode: true,
    })

    expect(capturedEvent().properties.$ai_input).toBeNull()
  })

  it('captures an error event and rethrows', async () => {
    const model = createMockV3EmbeddingModel()
    const error = Object.assign(new Error('rate limited'), { statusCode: 429 })
    ;(model.doEmbed as vi.Mock).mockRejectedValue(error)

    await expect(
      embedWithTracing({ model, value: 'hello', maxRetries: 0, posthog: mockPostHogClient })
    ).rejects.toThrow('rate limited')

    const { event, properties } = capturedEvent()
    expect(event).toBe('$ai_embedding')
    expect(properties.$ai_is_error).toBe(true)
    expect(properties.$ai_http_status).toBe(429)
  })
})
