import { PostHog } from 'posthog-node'
import { captureSpan, createPostHogSpanProcessor, PostHogSpanProcessor, PostHogSpanMapper } from '../src/otel'
import { flushPromises } from './test-utils'

const mockSpanContext = (traceId: string) => ({
  traceId,
  spanId: '0000000000000001',
  traceFlags: 1,
})

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

describe('OTEL span mapping', () => {
  let mockPostHogClient: PostHog

  beforeEach(() => {
    jest.clearAllMocks()
    mockPostHogClient = new (PostHog as any)()
  })

  it('maps doGenerate spans into PostHog AI generation events', async () => {
    await captureSpan(
      {
        attributes: {
          'ai.operationId': 'ai.generateText.doGenerate',
          'ai.model.id': 'gpt-4o-mini',
          'ai.model.provider': 'openai',
          'ai.prompt.messages': JSON.stringify([{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]),
          'ai.response.text': 'Hi there!',
          'ai.usage.promptTokens': 12,
          'ai.usage.completionTokens': 8,
          'ai.usage.totalTokens': 20,
          'ai.settings.temperature': 0.2,
          'ai.settings.maxOutputTokens': 200,
          'ai.telemetry.metadata.conversation_id': 'conv_123',
        },
        duration: [1, 500000000],
        status: { code: 1 },
        spanContext: () => mockSpanContext('otel-trace-123'),
      } as any,
      mockPostHogClient,
      {
        posthogDistinctId: 'user_123',
      }
    )

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const properties = captureCall[0].properties

    expect(properties.$ai_framework).toBe('vercel')
    expect(properties.$ai_framework_version).toBe('6')
    expect(properties.$ai_model).toBe('gpt-4o-mini')
    expect(properties.$ai_provider).toBe('openai')
    expect(properties.$ai_trace_id).toBe('otel-trace-123')
    expect(properties.$ai_input_tokens).toBe(12)
    expect(properties.$ai_output_tokens).toBe(8)
    expect(properties.$ai_model_parameters).toEqual(
      expect.objectContaining({
        temperature: 0.2,
      })
    )
    expect(properties.conversation_id).toBe('conv_123')
  })

  it('maps stream span TTFT from ai.response.msToFirstChunk', async () => {
    await captureSpan(
      {
        attributes: {
          'ai.operationId': 'ai.streamText.doStream',
          'ai.model.id': 'claude-3-7-sonnet',
          'ai.model.provider': 'anthropic',
          'ai.prompt.messages': JSON.stringify([{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }]),
          'ai.response.text': 'Hello',
          'ai.response.msToFirstChunk': 250,
          'ai.usage.promptTokens': 10,
          'ai.usage.completionTokens': 6,
        },
        duration: [0, 900000000],
        status: { code: 1 },
        spanContext: () => mockSpanContext('otel-stream-trace'),
      } as any,
      mockPostHogClient,
      {
        posthogDistinctId: 'user_abc',
      }
    )

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0].properties.$ai_time_to_first_token).toBe(0.25)
  })

  it('respects privacy mode for telemetry spans', async () => {
    await captureSpan(
      {
        attributes: {
          'ai.operationId': 'ai.generateText.doGenerate',
          'ai.model.id': 'gpt-4o-mini',
          'ai.model.provider': 'openai',
          'ai.prompt.messages': JSON.stringify([{ role: 'user', content: [{ type: 'text', text: 'Secret text' }] }]),
          'ai.response.text': 'Secret response',
          'ai.usage.promptTokens': 4,
          'ai.usage.completionTokens': 3,
        },
        duration: [0, 300000000],
        status: { code: 1 },
        spanContext: () => mockSpanContext('otel-private-trace'),
      } as any,
      mockPostHogClient,
      {
        posthogDistinctId: 'user_private',
        posthogPrivacyMode: true,
      }
    )

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0].properties.$ai_input).toBeNull()
    expect(captureCall[0].properties.$ai_output_choices).toBeNull()
  })

  it('span processor filters non-model spans and captures doGenerate spans', async () => {
    const spanProcessor = createPostHogSpanProcessor(mockPostHogClient, {
      posthogDistinctId: 'processor-user',
    })

    spanProcessor.onEnd({
      attributes: {
        'ai.operationId': 'ai.generateText',
        'ai.model.id': 'gpt-4o-mini',
      },
      status: { code: 1 },
      spanContext: () => mockSpanContext('ignored-trace'),
    } as any)

    spanProcessor.onEnd({
      attributes: {
        'ai.operationId': 'ai.generateText.doGenerate',
        'ai.model.id': 'gpt-4o-mini',
        'ai.model.provider': 'openai',
        'ai.prompt.messages': JSON.stringify([{ role: 'user', content: [{ type: 'text', text: 'Ping' }] }]),
        'ai.response.text': 'Pong',
        'ai.usage.promptTokens': 3,
        'ai.usage.completionTokens': 2,
      },
      duration: [0, 120000000],
      status: { code: 1 },
      spanContext: () => mockSpanContext('accepted-trace'),
    } as any)

    await flushPromises()

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0].properties.$ai_trace_id).toBe('accepted-trace')
  })

  it('creates a PostHog span processor', async () => {
    const spanProcessor = createPostHogSpanProcessor(mockPostHogClient, {
      posthogDistinctId: 'processor-user',
    })
    expect(spanProcessor).toBeInstanceOf(PostHogSpanProcessor)

    await captureSpan(
      {
        attributes: {
          'ai.operationId': 'ai.generateText.doGenerate',
          'ai.model.id': 'gpt-4o-mini',
          'ai.model.provider': 'openai',
          'ai.prompt.messages': JSON.stringify([{ role: 'user', content: [{ type: 'text', text: 'Ping' }] }]),
          'ai.response.text': 'Pong',
          'ai.usage.promptTokens': 3,
          'ai.usage.completionTokens': 2,
        },
        duration: [0, 120000000],
        status: { code: 1 },
        spanContext: () => mockSpanContext('alias-trace'),
      } as any,
      mockPostHogClient,
      { posthogDistinctId: 'processor-user' }
    )

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
  })

  it('supports custom mappers', async () => {
    const customMapper: PostHogSpanMapper = {
      name: 'custom-openai',
      canMap: (span) => Boolean(span.attributes?.['openai.request.model']),
      map: (span) => {
        const model = String(span.attributes?.['openai.request.model'] || 'gpt-4.1')
        return {
          provider: 'openai',
          model,
          input: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
          output: [{ role: 'assistant', content: 'world' }],
          latency: 0.1,
          usage: { inputTokens: 1, outputTokens: 1 },
          posthogProperties: { source: 'custom-mapper' },
        }
      },
    }

    await captureSpan(
      {
        attributes: {
          'openai.request.model': 'gpt-4.1',
        },
        duration: [0, 100000000],
        status: { code: 1 },
        spanContext: () => mockSpanContext('custom-mapper-trace'),
      } as any,
      mockPostHogClient,
      { posthogDistinctId: 'custom-user', mappers: [customMapper] }
    )

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0].properties.$ai_model).toBe('gpt-4.1')
    expect(captureCall[0].properties.source).toBe('custom-mapper')
  })

  it('supports shouldExportSpan gating', async () => {
    await captureSpan(
      {
        attributes: {
          'ai.operationId': 'ai.generateText.doGenerate',
          'ai.model.id': 'gpt-4o-mini',
          'ai.model.provider': 'openai',
          'ai.prompt.messages': JSON.stringify([{ role: 'user', content: [{ type: 'text', text: 'Ping' }] }]),
          'ai.response.text': 'Pong',
          'ai.usage.promptTokens': 3,
          'ai.usage.completionTokens': 2,
        },
        duration: [0, 120000000],
        status: { code: 1 },
        spanContext: () => mockSpanContext('gated-trace'),
      } as any,
      mockPostHogClient,
      {
        posthogDistinctId: 'gated-user',
        shouldExportSpan: () => false,
      }
    )

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(0)
  })

  it('maps generateObject.doGenerate spans', async () => {
    await captureSpan(
      {
        attributes: {
          'ai.operationId': 'ai.generateObject.doGenerate',
          'ai.model.id': 'gpt-4.1',
          'ai.model.provider': 'openai',
          'ai.prompt.messages': JSON.stringify([{ role: 'user', content: [{ type: 'text', text: 'Profile Jane' }] }]),
          'ai.response.object': JSON.stringify({ name: 'Jane', age: 31 }),
          'ai.response.finishReason': 'stop',
          'ai.usage.promptTokens': 22,
          'ai.usage.completionTokens': 11,
          'ai.schema.name': 'UserProfile',
        },
        duration: [0, 200000000],
        status: { code: 1 },
        spanContext: () => mockSpanContext('generate-object-trace'),
      } as any,
      mockPostHogClient,
      { posthogDistinctId: 'object-user' }
    )

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0].properties.$ai_model).toBe('gpt-4.1')
    expect(captureCall[0].properties.ai_finish_reason).toBe('stop')
    expect(captureCall[0].properties.ai_schema_name).toBe('UserProfile')
    expect(captureCall[0].properties.$ai_output_choices[0].content[0].type).toBe('object')
  })

  it('maps embed.doEmbed spans as embedding events', async () => {
    await captureSpan(
      {
        attributes: {
          'ai.operationId': 'ai.embed.doEmbed',
          'ai.model.id': 'text-embedding-3-large',
          'ai.model.provider': 'openai',
          'ai.value': 'hello world',
          'ai.embedding': JSON.stringify([0.1, 0.2, 0.3]),
          'ai.usage.tokens': 6,
        },
        duration: [0, 50000000],
        status: { code: 1 },
        spanContext: () => mockSpanContext('embed-trace'),
      } as any,
      mockPostHogClient,
      { posthogDistinctId: 'embed-user' }
    )

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0].event).toBe('$ai_embedding')
    expect(captureCall[0].properties.$ai_input_tokens).toBe(6)
    expect(captureCall[0].properties.$ai_output_choices).toBeNull()
  })

  it('maps ai.prompt.tools into $ai_tools', async () => {
    await captureSpan(
      {
        attributes: {
          'ai.operationId': 'ai.generateText.doGenerate',
          'ai.model.id': 'gpt-4o-mini',
          'ai.model.provider': 'openai',
          'ai.prompt.messages': JSON.stringify([{ role: 'user', content: [{ type: 'text', text: 'Weather?' }] }]),
          'ai.prompt.tools': [
            JSON.stringify({
              type: 'function',
              name: 'get_weather',
              description: 'Get weather for location',
            }),
          ],
          'ai.response.text': 'It is sunny',
          'ai.usage.promptTokens': 3,
          'ai.usage.completionTokens': 4,
        },
        duration: [0, 120000000],
        status: { code: 1 },
        spanContext: () => mockSpanContext('tools-trace'),
      } as any,
      mockPostHogClient,
      { posthogDistinctId: 'tools-user' }
    )

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0].properties.$ai_tools).toEqual([
      {
        type: 'function',
        name: 'get_weather',
        description: 'Get weather for location',
      },
    ])
  })

  it('maps ai.response.files image entries into output image blocks', async () => {
    await captureSpan(
      {
        attributes: {
          'ai.operationId': 'ai.generateText.doGenerate',
          'ai.model.id': 'gemini-2.5-flash',
          'ai.model.provider': 'google',
          'ai.prompt.messages': JSON.stringify([{ role: 'user', content: [{ type: 'text', text: 'Generate image' }] }]),
          'ai.response.files': JSON.stringify([
            {
              mimeType: 'image/png',
              data: 'iVBORw0KGgoAAAANSUhEUgAA',
            },
          ]),
          'ai.usage.promptTokens': 7,
          'ai.usage.completionTokens': 3,
        },
        duration: [0, 220000000],
        status: { code: 1 },
        spanContext: () => mockSpanContext('files-image-trace'),
      } as any,
      mockPostHogClient,
      { posthogDistinctId: 'image-user' }
    )

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0].properties.$ai_output_choices[0].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'file',
          mediaType: 'image/png',
          data: expect.any(String),
        }),
      ])
    )
  })

  it('maps providerMetadata inlineData (Gemini) into output media blocks', async () => {
    await captureSpan(
      {
        attributes: {
          'ai.operationId': 'ai.generateText.doGenerate',
          'ai.model.id': 'gemini-2.5-flash',
          'ai.model.provider': 'google',
          'ai.prompt.messages': JSON.stringify([{ role: 'user', content: [{ type: 'text', text: 'Generate image' }] }]),
          'ai.response.providerMetadata': JSON.stringify({
            google: {
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        inlineData: {
                          mimeType: 'image/jpeg',
                          data: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD',
                        },
                      },
                    ],
                  },
                },
              ],
            },
          }),
          'ai.usage.promptTokens': 9,
          'ai.usage.completionTokens': 4,
        },
        duration: [0, 190000000],
        status: { code: 1 },
        spanContext: () => mockSpanContext('provider-inline-trace'),
      } as any,
      mockPostHogClient,
      { posthogDistinctId: 'provider-inline-user' }
    )

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const content = captureCall[0].properties.$ai_output_choices[0].content
    expect(content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'file',
          mediaType: 'image/jpeg',
          data: expect.any(String),
        }),
      ])
    )
  })

  it('maps ai.response.files URL image entries when inline data is absent', async () => {
    await captureSpan(
      {
        attributes: {
          'ai.operationId': 'ai.generateText.doGenerate',
          'ai.model.id': 'gemini-2.5-flash',
          'ai.model.provider': 'google',
          'ai.prompt.messages': JSON.stringify([{ role: 'user', content: [{ type: 'text', text: 'Generate image' }] }]),
          'ai.response.files': JSON.stringify([
            {
              mimeType: 'image/webp',
              url: 'https://example.com/generated.webp',
            },
          ]),
          'ai.usage.promptTokens': 9,
          'ai.usage.completionTokens': 4,
        },
        duration: [0, 190000000],
        status: { code: 1 },
        spanContext: () => mockSpanContext('files-url-trace'),
      } as any,
      mockPostHogClient,
      { posthogDistinctId: 'files-url-user' }
    )

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const content = captureCall[0].properties.$ai_output_choices[0].content
    expect(content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'file',
          mediaType: 'image/webp',
          data: 'https://example.com/generated.webp',
        }),
      ])
    )
  })

  it('falls back to providerMetadata text parts when ai.response.text is missing', async () => {
    await captureSpan(
      {
        attributes: {
          'ai.operationId': 'ai.generateText.doGenerate',
          'ai.model.id': 'gemini-2.5-flash',
          'ai.model.provider': 'google',
          'ai.prompt.messages': JSON.stringify([{ role: 'user', content: [{ type: 'text', text: 'Generate image' }] }]),
          'ai.response.providerMetadata': JSON.stringify({
            google: {
              candidates: [
                {
                  content: {
                    parts: [{ text: 'Here is your generated image' }],
                  },
                },
              ],
            },
          }),
          'ai.usage.promptTokens': 9,
          'ai.usage.completionTokens': 4,
        },
        duration: [0, 190000000],
        status: { code: 1 },
        spanContext: () => mockSpanContext('provider-text-fallback-trace'),
      } as any,
      mockPostHogClient,
      { posthogDistinctId: 'provider-text-user' }
    )

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const content = captureCall[0].properties.$ai_output_choices[0].content
    expect(content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: 'Here is your generated image',
        }),
      ])
    )
  })

  it('maps unknown ai.response.* media shapes via generic fallback', async () => {
    await captureSpan(
      {
        attributes: {
          'ai.operationId': 'ai.generateText.doGenerate',
          'ai.model.id': 'gemini-2.5-flash-image',
          'ai.model.provider': 'google',
          'ai.prompt.messages': JSON.stringify([{ role: 'user', content: [{ type: 'text', text: 'Draw a cat' }] }]),
          'ai.response.generated': JSON.stringify({
            result: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'image/png',
                    data: 'iVBORw0KGgoAAAANSUhEUgAA',
                  },
                },
              ],
            },
          }),
          'ai.usage.promptTokens': 11,
          'ai.usage.completionTokens': 1301,
        },
        duration: [0, 300000000],
        status: { code: 1 },
        spanContext: () => mockSpanContext('unknown-response-media-trace'),
      } as any,
      mockPostHogClient,
      { posthogDistinctId: 'unknown-response-media-user' }
    )

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0].properties.$ai_output_choices[0].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'file',
          mediaType: 'image/png',
          data: expect.any(String),
        }),
      ])
    )
  })

  it('keeps text and tool-call output mapping unchanged', async () => {
    await captureSpan(
      {
        attributes: {
          'ai.operationId': 'ai.generateText.doGenerate',
          'ai.model.id': 'gpt-4o-mini',
          'ai.model.provider': 'openai',
          'ai.prompt.messages': JSON.stringify([{ role: 'user', content: [{ type: 'text', text: 'Use a tool' }] }]),
          'ai.response.text': 'Let me check',
          'ai.response.toolCalls': JSON.stringify([
            { toolName: 'lookup', toolCallId: 'tc-1', input: { q: 'weather' } },
          ]),
          'ai.usage.promptTokens': 3,
          'ai.usage.completionTokens': 4,
        },
        duration: [0, 120000000],
        status: { code: 1 },
        spanContext: () => mockSpanContext('text-tool-regression'),
      } as any,
      mockPostHogClient,
      { posthogDistinctId: 'regression-user' }
    )

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0].properties.$ai_output_choices).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check' },
          {
            type: 'tool-call',
            id: 'tc-1',
            function: {
              name: 'lookup',
              arguments: '{"q":"weather"}',
            },
          },
        ],
      },
    ])
  })

  it('maps ai.response.messages with multiple assistant parts including image files', async () => {
    await captureSpan(
      {
        attributes: {
          'ai.operationId': 'ai.generateText.doGenerate',
          'ai.model.id': 'gemini-2.5-flash-image',
          'ai.model.provider': 'google',
          'ai.prompt.messages': JSON.stringify([{ role: 'user', content: [{ type: 'text', text: 'Draw a cat' }] }]),
          'ai.response.messages': JSON.stringify([
            {
              role: 'assistant',
              content: [
                { type: 'text', text: 'Here is your image' },
                {
                  type: 'file',
                  mediaType: 'image/png',
                  data: 'iVBORw0KGgoAAAANSUhEUgAA',
                },
              ],
            },
          ]),
          'ai.usage.promptTokens': 11,
          'ai.usage.completionTokens': 1200,
        },
        duration: [0, 300000000],
        status: { code: 1 },
        spanContext: () => mockSpanContext('response-messages-trace'),
      } as any,
      mockPostHogClient,
      { posthogDistinctId: 'response-messages-user' }
    )

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0].properties.$ai_output_choices).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Here is your image' },
          {
            type: 'file',
            name: 'generated_file',
            mediaType: 'image/png',
            data: expect.any(String),
          },
        ],
      },
    ])
  })

  it('maps ai.response.messages image-typed parts into file output blocks', async () => {
    await captureSpan(
      {
        attributes: {
          'ai.operationId': 'ai.generateText.doGenerate',
          'ai.model.id': 'gemini-2.5-flash-image',
          'ai.model.provider': 'google',
          'ai.prompt.messages': JSON.stringify([{ role: 'user', content: [{ type: 'text', text: 'Draw a cat' }] }]),
          'ai.response.messages': JSON.stringify([
            {
              role: 'assistant',
              content: [
                { type: 'text', text: 'Image ready' },
                { type: 'image', image_url: 'https://example.com/generated.png', mediaType: 'image/png' },
              ],
            },
          ]),
          'ai.usage.promptTokens': 11,
          'ai.usage.completionTokens': 1200,
        },
        duration: [0, 300000000],
        status: { code: 1 },
        spanContext: () => mockSpanContext('response-messages-image-type-trace'),
      } as any,
      mockPostHogClient,
      { posthogDistinctId: 'response-messages-image-type-user' }
    )

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0].properties.$ai_output_choices).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Image ready' },
          {
            type: 'file',
            name: 'generated_file',
            mediaType: 'image/png',
            data: 'https://example.com/generated.png',
          },
        ],
      },
    ])
  })

  it('maps media blocks from generic gen_ai.response.* attributes', async () => {
    await captureSpan(
      {
        attributes: {
          'ai.operationId': 'ai.generateText.doGenerate',
          'ai.model.id': 'gemini-2.5-flash-image',
          'ai.model.provider': 'google',
          'ai.prompt.messages': JSON.stringify([{ role: 'user', content: [{ type: 'text', text: 'Draw a cat' }] }]),
          'gen_ai.response.payload': JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: 'image/png',
                        data: 'iVBORw0KGgoAAAANSUhEUgAA',
                      },
                    },
                  ],
                },
              },
            ],
          }),
          'ai.usage.promptTokens': 11,
          'ai.usage.completionTokens': 1200,
        },
        duration: [0, 300000000],
        status: { code: 1 },
        spanContext: () => mockSpanContext('generic-gen-ai-response-media-trace'),
      } as any,
      mockPostHogClient,
      { posthogDistinctId: 'generic-gen-ai-response-media-user' }
    )

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0].properties.$ai_output_choices[0].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'file',
          mediaType: 'image/png',
          data: expect.any(String),
        }),
      ])
    )
  })

  it('maps multiple response messages when present', async () => {
    await captureSpan(
      {
        attributes: {
          'ai.operationId': 'ai.generateText.doGenerate',
          'ai.model.id': 'gpt-4o-mini',
          'ai.model.provider': 'openai',
          'ai.prompt.messages': JSON.stringify([{ role: 'user', content: [{ type: 'text', text: 'Two lines' }] }]),
          'ai.response.messages': JSON.stringify([
            { role: 'assistant', content: [{ type: 'text', text: 'Line one' }] },
            { role: 'assistant', content: [{ type: 'text', text: 'Line two' }] },
          ]),
          'ai.usage.promptTokens': 5,
          'ai.usage.completionTokens': 10,
        },
        duration: [0, 150000000],
        status: { code: 1 },
        spanContext: () => mockSpanContext('multiple-messages-trace'),
      } as any,
      mockPostHogClient,
      { posthogDistinctId: 'multiple-messages-user' }
    )

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0].properties.$ai_output_choices).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'Line one' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Line two' }] },
    ])
  })

  it('does not map parent ai.generateText span even if it has response attributes', async () => {
    await captureSpan(
      {
        attributes: {
          'ai.operationId': 'ai.generateText',
          'ai.model.id': 'gpt-4o-mini',
          'ai.model.provider': 'openai',
          'ai.response.text': 'Parent span text',
          'ai.usage.promptTokens': 10,
          'ai.usage.completionTokens': 8,
        },
        duration: [0, 100000000],
        status: { code: 1 },
        spanContext: () => mockSpanContext('parent-trace'),
      } as any,
      mockPostHogClient,
      { posthogDistinctId: 'parent-user' }
    )

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(0)
  })
})
