import type { PostHog } from 'posthog-node'
import PostHogAnthropic from '../src/anthropic'
import PostHogOpenAI from '../src/openai'
import { PostHogAzureOpenAI } from '../src/openai/azure'

const chatCompletion = {
  id: 'chatcmpl_provider_promise',
  object: 'chat.completion',
  created: 1,
  model: 'gpt-4o-mini',
  choices: [
    {
      index: 0,
      finish_reason: 'stop',
      logprobs: null,
      message: {
        role: 'assistant',
        content: '{"city":"Paris"}',
        refusal: null,
      },
    },
  ],
  usage: {
    prompt_tokens: 4,
    completion_tokens: 3,
    total_tokens: 7,
  },
}

const responsesResult = {
  id: 'resp_provider_promise',
  object: 'response',
  created_at: 1,
  status: 'completed',
  model: 'gpt-4o-mini',
  output: [
    {
      id: 'msg_provider_promise',
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          annotations: [],
          logprobs: [],
          text: '{"city":"Paris"}',
        },
      ],
    },
  ],
  usage: {
    input_tokens: 4,
    output_tokens: 3,
    total_tokens: 7,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  },
}

const anthropicMessage = {
  id: 'msg_provider_promise',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-4-20250514',
  content: [{ type: 'text', text: 'Hello' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 4, output_tokens: 1 },
}

const posthogClient = (): PostHog =>
  ({
    capture: jest.fn(),
    captureImmediate: jest.fn(),
    privacy_mode: false,
  }) as unknown as PostHog

const jsonResponse = (body: unknown, requestIDHeader = 'x-request-id'): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      [requestIDHeader]: 'req_provider_promise',
    },
  })

const locationSchema = {
  type: 'object',
  properties: { city: { type: 'string' } },
  required: ['city'],
  additionalProperties: false,
}

const chatResponseFormat = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'location',
    schema: locationSchema,
  },
}

const responsesFormat = {
  type: 'json_schema' as const,
  name: 'location',
  schema: locationSchema,
}

const requestURL = (request: RequestInfo | URL): string => (request instanceof Request ? request.url : String(request))

describe('provider promise compatibility with real SDK resources', () => {
  test('OpenAI chat.completions.parse composes through the wrapped create promise', async () => {
    const fetch = jest.fn(async () => jsonResponse(chatCompletion))
    const posthog = posthogClient()
    const client = new PostHogOpenAI({ apiKey: 'test', posthog, fetch })

    const promise = client.chat.completions.parse({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Where?' }],
      response_format: chatResponseFormat,
      posthogDistinctId: 'test-id',
    })

    expect(typeof promise.asResponse).toBe('function')
    expect(typeof promise.withResponse).toBe('function')
    const { data, request_id } = await promise.withResponse()

    expect(data.choices[0]?.message.parsed).toEqual({ city: 'Paris' })
    expect((data as { _request_id?: string })._request_id).toBe('req_provider_promise')
    expect(Object.keys(data)).not.toContain('_request_id')
    expect(request_id).toBe('req_provider_promise')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(posthog.capture).toHaveBeenCalledTimes(1)
  })

  test('Azure chat and responses parse compose through wrapped provider promises', async () => {
    const fetch = jest.fn(async (request: RequestInfo | URL) =>
      jsonResponse(requestURL(request).includes('/responses') ? responsesResult : chatCompletion)
    )
    const posthog = posthogClient()
    const client = new PostHogAzureOpenAI({
      apiKey: 'test',
      apiVersion: '2025-01-01-preview',
      baseURL: 'https://example.openai.azure.com/openai',
      posthog,
      fetch,
    })

    const chatPromise = client.chat.completions.parse({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Where?' }],
      response_format: chatResponseFormat,
      posthogDistinctId: 'test-id',
    })
    expect(Object.prototype.hasOwnProperty.call(client.responses, 'create')).toBe(false)
    const responsePromise = client.responses.parse({
      model: 'gpt-4o-mini',
      input: 'Where?',
      text: { format: responsesFormat },
      posthogDistinctId: 'test-id',
    })
    expect(Object.prototype.hasOwnProperty.call(client.responses, 'create')).toBe(false)

    expect(typeof chatPromise.withResponse).toBe('function')
    expect(typeof responsePromise.asResponse).toBe('function')
    const [{ data: chat }, { data: response }] = await Promise.all([
      chatPromise.withResponse(),
      responsePromise.withResponse(),
    ])

    expect(chat.choices[0]?.message.parsed).toEqual({ city: 'Paris' })
    expect((chat as { _request_id?: string })._request_id).toBe('req_provider_promise')
    expect(Object.keys(chat)).not.toContain('_request_id')
    expect(response.output_parsed).toEqual({ city: 'Paris' })
    expect((response as { _request_id?: string })._request_id).toBe('req_provider_promise')
    expect(Object.keys(response)).not.toContain('_request_id')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(posthog.capture).toHaveBeenCalledTimes(2)
  })

  test('Azure create promises retain raw-response helpers and transformed data', async () => {
    const fetch = jest.fn(async (request: RequestInfo | URL) =>
      jsonResponse(requestURL(request).includes('/responses') ? responsesResult : chatCompletion)
    )
    const client = new PostHogAzureOpenAI({
      apiKey: 'test',
      apiVersion: '2025-01-01-preview',
      baseURL: 'https://example.openai.azure.com/openai',
      posthog: posthogClient(),
      fetch,
    })

    const chatPromise = client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Hello' }],
    })
    const responsePromise = client.responses.create({ model: 'gpt-4o-mini', input: 'Hello' })

    expect(typeof chatPromise.asResponse).toBe('function')
    expect(typeof responsePromise.withResponse).toBe('function')
    const statusPromise = chatPromise._thenUnwrap((_data, props) => props.response.status)
    expect((await chatPromise.withResponse()).data.id).toBe(chatCompletion.id)
    expect((await responsePromise.withResponse()).data.id).toBe(responsesResult.id)
    expect(await statusPromise).toBe(200)
  })

  test('Anthropic create promises retain raw-response helpers and transformed data', async () => {
    const fetch = jest.fn(async () => jsonResponse(anthropicMessage, 'request-id'))
    const client = new PostHogAnthropic({ apiKey: 'test', posthog: posthogClient(), fetch })

    const promise = client.messages.create({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 32,
    })

    expect(typeof promise.asResponse).toBe('function')
    expect(typeof promise.withResponse).toBe('function')
    const rawResponse = await promise.asResponse()
    const { data, request_id } = await promise.withResponse()

    expect(rawResponse.status).toBe(200)
    expect(rawResponse.headers.get('request-id')).toBe('req_provider_promise')
    expect(rawResponse.bodyUsed).toBe(true)
    await expect(rawResponse.json()).rejects.toThrow()
    expect(data.id).toBe(anthropicMessage.id)
    expect(request_id).toBe('req_provider_promise')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
