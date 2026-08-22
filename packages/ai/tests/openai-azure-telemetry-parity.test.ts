import PostHogOpenAI from '../src/openai'
import { PostHogAzureOpenAI } from '../src/openai/azure'

const binary = 'A'.repeat(80)
const chatUsage = {
  prompt_tokens: 12,
  completion_tokens: 7,
  total_tokens: 19,
  prompt_tokens_details: { cached_tokens: 3, cache_write_tokens: 2 },
  completion_tokens_details: { reasoning_tokens: 4 },
}
const responsesUsage = {
  input_tokens: 9,
  output_tokens: 5,
  total_tokens: 14,
  input_tokens_details: { cached_tokens: 2, cache_write_tokens: 1 },
  output_tokens_details: { reasoning_tokens: 3 },
}
const embeddingUsage = { prompt_tokens: 4, total_tokens: 4 }
const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'lookup_weather',
      description: 'Look up weather',
      parameters: { type: 'object', properties: {} },
    },
  },
]

function providerFetch(): jest.Mock {
  return jest.fn(async (input: string | URL | Request) => {
    const pathname = new URL(input instanceof Request ? input.url : String(input)).pathname
    let body: Record<string, unknown>
    if (pathname.includes('/embeddings')) {
      body = { object: 'list', data: [], model: 'text-embedding-3-small', usage: embeddingUsage }
    } else if (pathname.includes('/responses')) {
      body = {
        id: 'resp-parity',
        object: 'response',
        created_at: 1,
        model: 'gpt-4o',
        status: 'completed',
        output: [
          {
            id: 'image-parity',
            type: 'image_generation_call',
            status: 'completed',
            result: binary,
          },
          {
            id: 'message-parity',
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [
              {
                type: 'output_text',
                text: 'Weather result',
                annotations: [{ type: 'url_citation', url: 'https://example.com', start_index: 0, end_index: 7 }],
              },
            ],
          },
        ],
        usage: responsesUsage,
        service_tier: 'default',
      }
    } else {
      body = {
        id: 'chatcmpl-parity',
        object: 'chat.completion',
        created: 1,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: 'Weather result',
              annotations: [{ type: 'url_citation', url: 'https://example.com' }],
            },
          },
        ],
        usage: chatUsage,
        service_tier: 'default',
      }
    }

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-request-id': 'req-parity' },
    })
  })
}

function providerErrorFetch(): jest.Mock {
  return jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          error: { message: 'provider rejected the request', type: 'invalid_request_error' },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      )
  )
}

function createPostHogMock() {
  return { capture: jest.fn(), captureImmediate: jest.fn(), privacy_mode: false }
}

const providerCases = [
  {
    provider: 'openai',
    createClient: (fetch: jest.Mock, posthog: ReturnType<typeof createPostHogMock>) =>
      new PostHogOpenAI({
        apiKey: 'mock-key',
        baseURL: 'https://openai.test/v1',
        fetch: fetch as typeof globalThis.fetch,
        posthog: posthog as any,
      }),
  },
  {
    provider: 'azure',
    createClient: (fetch: jest.Mock, posthog: ReturnType<typeof createPostHogMock>) =>
      new PostHogAzureOpenAI({
        apiKey: 'mock-key',
        apiVersion: '2025-04-01-preview',
        baseURL: 'https://azure.test/openai',
        fetch: fetch as typeof globalThis.fetch,
        posthog,
      } as any),
  },
] as const

describe.each(providerCases)('$provider OpenAI-compatible telemetry parity', ({ provider, createClient }) => {
  test('captures chat usage, tools, stop reason, and web search consistently', async () => {
    const posthog = createPostHogMock()
    const client = createClient(providerFetch(), posthog)

    await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Weather?' }],
      tools,
    })

    const properties = posthog.capture.mock.calls[0][0].properties
    expect(properties).toMatchObject({
      $ai_provider: provider,
      $ai_usage: chatUsage,
      $ai_reasoning_tokens: 4,
      $ai_cache_read_input_tokens: 3,
      $ai_cache_creation_input_tokens: 2,
      $ai_web_search_count: 1,
      $ai_stop_reason: 'stop',
      $ai_tools: tools,
    })
  })

  test('formats and sanitizes Responses output while preserving usage, tools, and web search', async () => {
    const posthog = createPostHogMock()
    const client = createClient(providerFetch(), posthog)

    await client.responses.create({
      model: 'gpt-4o',
      input: 'Create an image and check the weather.',
      tools,
    } as any)

    const properties = posthog.capture.mock.calls[0][0].properties
    expect(properties).toMatchObject({
      $ai_provider: provider,
      $ai_usage: responsesUsage,
      $ai_web_search_count: 1,
      $ai_stop_reason: 'completed',
      $ai_tools: tools,
      $ai_output_choices: [
        {
          role: 'assistant',
          content: [
            { type: 'image', image: '[base64 image redacted]' },
            { type: 'text', text: 'Weather result' },
          ],
        },
      ],
    })
    expect(JSON.stringify(properties)).not.toContain(binary)
  })

  test('sanitizes Responses instructions on success', async () => {
    const posthog = createPostHogMock()
    const client = createClient(providerFetch(), posthog)

    await client.responses.create({
      model: 'gpt-4o',
      input: 'Describe the image.',
      instructions: `data:image/png;base64,${binary}`,
    } as any)

    const properties = posthog.capture.mock.calls[0][0].properties
    expect(JSON.stringify(properties.$ai_input)).not.toContain(binary)
    expect(JSON.stringify(properties.$ai_input)).toContain('[base64 image/png redacted]')
  })

  test('sanitizes Responses instructions on provider errors', async () => {
    const posthog = createPostHogMock()
    const client = createClient(providerErrorFetch(), posthog)

    await expect(
      client.responses.create({
        model: 'gpt-4o',
        input: 'Describe the image.',
        instructions: `data:image/png;base64,${binary}`,
      } as any)
    ).rejects.toThrow('provider rejected the request')

    const properties = posthog.capture.mock.calls[0][0].properties
    expect(JSON.stringify(properties.$ai_input)).not.toContain(binary)
    expect(JSON.stringify(properties.$ai_input)).toContain('[base64 image/png redacted]')
  })

  test('captures raw embedding usage consistently', async () => {
    const posthog = createPostHogMock()
    const client = createClient(providerFetch(), posthog)

    await client.embeddings.create({ model: 'text-embedding-3-small', input: 'Hello' })

    expect(posthog.capture.mock.calls[0][0].properties).toMatchObject({
      $ai_provider: provider,
      $ai_input_tokens: 4,
      $ai_usage: embeddingUsage,
    })
  })
})
