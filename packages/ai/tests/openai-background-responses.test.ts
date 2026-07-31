import PostHogOpenAI from '../src/openai'
import { PostHogAzureOpenAI } from '../src/openai/azure'
import { BackgroundResponseTracker } from '../src/openai/background-responses'

const responseID = 'resp_background_test'
const output = [
  {
    id: 'msg_background_test',
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: 'Background work complete.', annotations: [], logprobs: [] }],
  },
]
const usage = {
  input_tokens: 12,
  input_tokens_details: { cached_tokens: 3 },
  output_tokens: 7,
  output_tokens_details: { reasoning_tokens: 2 },
  total_tokens: 19,
}

function responseBody(status: 'queued' | 'in_progress' | 'completed' | 'cancelled'): Record<string, unknown> {
  return {
    id: responseID,
    object: 'response',
    created_at: 1,
    model: 'gpt-4o-mini',
    status,
    output: status === 'completed' ? output : [],
    usage: status === 'completed' ? usage : null,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    parallel_tool_calls: true,
    temperature: 1,
    tool_choice: 'auto',
    tools: [],
    top_p: 1,
  }
}

function createFetchMock(): jest.Mock {
  let retrieveCount = 0

  return jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    const body =
      method === 'POST' ? responseBody('queued') : responseBody(++retrieveCount === 1 ? 'in_progress' : 'completed')

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_background_terminal',
      },
    })
  })
}

function createCancelFetchMock(): jest.Mock {
  return jest.fn(async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input)
    const body = new URL(url).pathname.endsWith(`/${responseID}/cancel`)
      ? responseBody('cancelled')
      : responseBody('queued')

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_background_cancelled',
      },
    })
  })
}

function createPostHogMock() {
  return {
    capture: jest.fn(),
    captureImmediate: jest.fn().mockResolvedValue(undefined),
    privacy_mode: false,
  }
}

function createStreamingFetchMock(
  events: Record<string, unknown>[],
  options: { invalidEvent?: boolean; streamError?: Error } = {}
): jest.Mock {
  return jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    if (method === 'POST') {
      return new Response(JSON.stringify(responseBody('queued')), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    const url = input instanceof Request ? input.url : String(input)
    if (url.includes('stream=true')) {
      if (options.streamError) {
        throw options.streamError
      }

      const body = options.invalidEvent
        ? 'data: {invalid-json\n\n'
        : `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }

    return new Response(JSON.stringify(responseBody('completed')), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
}

const providerCases = [
  {
    provider: 'openai',
    createClient: (fetchMock: jest.Mock, posthog: ReturnType<typeof createPostHogMock>) =>
      new PostHogOpenAI({
        apiKey: 'test-api-key',
        baseURL: 'https://openai.test/v1',
        fetch: fetchMock as typeof fetch,
        maxRetries: 0,
        posthog: posthog as any,
      }),
    expectedOutput: [
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Background work complete.' }],
      },
    ],
  },
  {
    provider: 'azure',
    createClient: (fetchMock: jest.Mock, posthog: ReturnType<typeof createPostHogMock>) =>
      new PostHogAzureOpenAI({
        apiKey: 'test-api-key',
        apiVersion: '2025-04-01-preview',
        baseURL: 'https://azure.test/openai',
        fetch: fetchMock as typeof fetch,
        maxRetries: 0,
        posthog,
      } as any),
    expectedOutput: output,
  },
] as const

async function createTrackedBackgroundResponse(client: ReturnType<(typeof providerCases)[number]['createClient']>) {
  await client.responses.create({
    model: 'gpt-4o-mini',
    input: 'Run this in the background.',
    background: true,
    temperature: 0.25,
    posthogDistinctId: 'background-user',
    posthogTraceId: 'background-trace',
    posthogProperties: { workflow: 'nightly' },
    posthogCaptureImmediate: true,
  })
}

describe.each(providerCases)('$provider background Responses', ({ provider, createClient, expectedOutput }) => {
  test('captures only the first terminal poll with the original monitoring context', async () => {
    const fetchMock = createFetchMock()
    const posthog = createPostHogMock()
    const client = createClient(fetchMock, posthog)

    const createPromise = client.responses.create({
      model: 'gpt-4o-mini',
      input: 'Run this in the background.',
      background: true,
      temperature: 0.25,
      posthogDistinctId: 'background-user',
      posthogTraceId: 'background-trace',
      posthogProperties: { workflow: 'nightly' },
      posthogCaptureImmediate: true,
    })
    expect((await createPromise).status).toBe('queued')

    const createRequestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(createRequestBody).toMatchObject({ model: 'gpt-4o-mini', background: true, temperature: 0.25 })
    expect(createRequestBody).not.toHaveProperty('posthogDistinctId')
    expect(posthog.capture).not.toHaveBeenCalled()
    expect(posthog.captureImmediate).not.toHaveBeenCalled()

    const pendingPoll = client.responses.retrieve(responseID)
    expect(typeof pendingPoll.withResponse).toBe('function')
    expect((await pendingPoll).status).toBe('in_progress')
    expect(posthog.captureImmediate).not.toHaveBeenCalled()

    const [firstTerminalPoll, duplicateTerminalPoll] = await Promise.all([
      client.responses.retrieve(responseID),
      client.responses.retrieve(responseID),
    ])
    expect(firstTerminalPoll.status).toBe('completed')
    expect(duplicateTerminalPoll.status).toBe('completed')
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls.slice(1).every((call) => call[1].method === 'GET')).toBe(true)
    expect(posthog.capture).not.toHaveBeenCalled()
    expect(posthog.captureImmediate).toHaveBeenCalledTimes(1)

    const event = posthog.captureImmediate.mock.calls[0][0]
    expect(event.distinctId).toBe('background-user')
    expect(event.event).toBe('$ai_generation')
    expect(event.properties).toMatchObject({
      $ai_provider: provider,
      $ai_model: 'gpt-4o-mini',
      $ai_input: [{ role: 'user', content: 'Run this in the background.' }],
      $ai_output_choices: expectedOutput,
      $ai_input_tokens: 12,
      $ai_output_tokens: 7,
      $ai_reasoning_tokens: 2,
      $ai_cache_read_input_tokens: 3,
      $ai_completion_id: responseID,
      $ai_stop_reason: 'completed',
      $ai_trace_id: 'background-trace',
      $ai_model_parameters: { temperature: 0.25 },
      $ai_provider_metadata: { request_id: 'req_background_terminal' },
      workflow: 'nightly',
    })
  })

  test('keeps the raw retrieve response body readable through asResponse', async () => {
    const fetchMock = createFetchMock()
    const posthog = createPostHogMock()
    const client = createClient(fetchMock, posthog)

    const response = await client.responses.retrieve('untracked-response').asResponse()

    await expect(response.json()).resolves.toMatchObject({ status: 'in_progress' })
    expect(posthog.captureImmediate).not.toHaveBeenCalled()
  })

  test('keeps a tracked cancel response body readable through asResponse', async () => {
    const fetchMock = createCancelFetchMock()
    const posthog = createPostHogMock()
    const client = createClient(fetchMock, posthog)
    await createTrackedBackgroundResponse(client)

    const response = await client.responses.cancel(responseID).asResponse()

    await expect(response.json()).resolves.toMatchObject({ status: 'cancelled' })
    expect(posthog.captureImmediate).not.toHaveBeenCalled()
  })

  test('captures a tracked cancellation once and preserves the cancel APIPromise contract', async () => {
    const fetchMock = createCancelFetchMock()
    const posthog = createPostHogMock()
    const client = createClient(fetchMock, posthog)
    await createTrackedBackgroundResponse(client)

    const cancelPromise = client.responses.cancel(responseID)
    expect(typeof cancelPromise.asResponse).toBe('function')
    expect(typeof cancelPromise.withResponse).toBe('function')

    const [{ data: cancelled }, rawResponse] = await Promise.all([
      cancelPromise.withResponse(),
      cancelPromise.asResponse(),
    ])
    expect(cancelled.status).toBe('cancelled')
    expect(rawResponse.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1][0])).toContain(`/responses/${responseID}/cancel`)
    expect(fetchMock.mock.calls[1][1].method).toBe('POST')
    expect(posthog.capture).not.toHaveBeenCalled()
    expect(posthog.captureImmediate).toHaveBeenCalledTimes(1)
    expect(posthog.captureImmediate.mock.calls[0][0]).toMatchObject({
      distinctId: 'background-user',
      event: '$ai_generation',
      properties: {
        $ai_provider: provider,
        $ai_model: 'gpt-4o-mini',
        $ai_input: [{ role: 'user', content: 'Run this in the background.' }],
        $ai_output_choices: [],
        $ai_input_tokens: 0,
        $ai_output_tokens: 0,
        $ai_completion_id: responseID,
        $ai_stop_reason: 'cancelled',
        $ai_trace_id: 'background-trace',
        $ai_provider_metadata: { request_id: 'req_background_cancelled' },
        workflow: 'nightly',
      },
    })

    const untrackedCancel = client.responses.cancel(responseID)
    expect(typeof untrackedCancel.asResponse).toBe('function')
    expect(typeof untrackedCancel.withResponse).toBe('function')
    expect((await untrackedCancel).status).toBe('cancelled')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(posthog.captureImmediate).toHaveBeenCalledTimes(1)
  })

  test('captures one terminal event from a streaming retrieval with the original context', async () => {
    const terminalEvent = { type: 'response.completed', sequence_number: 1, response: responseBody('completed') }
    const fetchMock = createStreamingFetchMock([
      { type: 'response.in_progress', sequence_number: 0, response: responseBody('in_progress') },
      terminalEvent,
      terminalEvent,
    ])
    const posthog = createPostHogMock()
    const client = createClient(fetchMock, posthog)
    await createTrackedBackgroundResponse(client)

    const retrievePromise = client.responses.retrieve(responseID, { stream: true })
    expect(typeof retrievePromise.withResponse).toBe('function')
    const stream = await retrievePromise
    const eventTypes: string[] = []
    for await (const event of stream) {
      eventTypes.push(event.type)
    }

    expect(eventTypes).toEqual(['response.in_progress', 'response.completed', 'response.completed'])
    expect(posthog.captureImmediate).toHaveBeenCalledTimes(1)
    expect(posthog.captureImmediate.mock.calls[0][0].properties).toMatchObject({
      $ai_provider: provider,
      $ai_input: [{ role: 'user', content: 'Run this in the background.' }],
      $ai_output_choices: expectedOutput,
      $ai_input_tokens: 12,
      $ai_output_tokens: 7,
      $ai_completion_id: responseID,
      $ai_trace_id: 'background-trace',
      workflow: 'nightly',
    })

    await client.responses.retrieve(responseID)
    expect(posthog.captureImmediate).toHaveBeenCalledTimes(1)
  })

  test('does not delay terminal stream delivery while immediate capture is pending', async () => {
    const terminalEvent = { type: 'response.completed', sequence_number: 1, response: responseBody('completed') }
    const fetchMock = createStreamingFetchMock([terminalEvent])
    const posthog = createPostHogMock()
    posthog.captureImmediate.mockReturnValue(new Promise<void>(() => undefined))
    const client = createClient(fetchMock, posthog)
    await createTrackedBackgroundResponse(client)

    const stream = await client.responses.retrieve(responseID, { stream: true })
    const events: string[] = []
    const consume = (async () => {
      for await (const event of stream) {
        events.push(event.type)
      }
      return events
    })()

    await expect(
      Promise.race([consume, new Promise<string[]>((resolve) => setTimeout(() => resolve(['timed-out']), 100))])
    ).resolves.toEqual(['response.completed'])
    expect(posthog.captureImmediate).toHaveBeenCalledTimes(1)
  })

  test('keeps the tracked context when a streaming retrieval is cancelled by the consumer', async () => {
    const fetchMock = createStreamingFetchMock([
      { type: 'response.in_progress', sequence_number: 0, response: responseBody('in_progress') },
      { type: 'response.completed', sequence_number: 1, response: responseBody('completed') },
    ])
    const posthog = createPostHogMock()
    const client = createClient(fetchMock, posthog)
    await createTrackedBackgroundResponse(client)

    const stream = await client.responses.retrieve(responseID, { stream: true })
    for await (const event of stream) {
      expect(event.type).toBe('response.in_progress')
      break
    }

    expect(posthog.captureImmediate).not.toHaveBeenCalled()
    expect((await client.responses.retrieve(responseID)).status).toBe('completed')
    await client.responses.retrieve(responseID)
    expect(posthog.captureImmediate).toHaveBeenCalledTimes(1)
  })

  test('keeps the tracked context when a streaming retrieval errors', async () => {
    const fetchMock = createStreamingFetchMock([], { invalidEvent: true })
    const posthog = createPostHogMock()
    const client = createClient(fetchMock, posthog)
    await createTrackedBackgroundResponse(client)

    const stream = await client.responses.retrieve(responseID, { stream: true })
    await expect(async () => {
      for await (const event of stream) {
        void event
      }
    }).rejects.toThrow()

    expect(posthog.captureImmediate).not.toHaveBeenCalled()
    expect((await client.responses.retrieve(responseID)).status).toBe('completed')
    await client.responses.retrieve(responseID)
    expect(posthog.captureImmediate).toHaveBeenCalledTimes(1)
  })

  test('keeps the tracked context when a streaming retrieval ends without a terminal response', async () => {
    const fetchMock = createStreamingFetchMock([
      { type: 'response.in_progress', sequence_number: 0, response: responseBody('in_progress') },
    ])
    const posthog = createPostHogMock()
    const client = createClient(fetchMock, posthog)
    await createTrackedBackgroundResponse(client)

    const stream = await client.responses.retrieve(responseID, { stream: true })
    for await (const event of stream) {
      expect(event.type).toBe('response.in_progress')
    }

    expect(posthog.captureImmediate).not.toHaveBeenCalled()
    expect((await client.responses.retrieve(responseID)).status).toBe('completed')
    await client.responses.retrieve(responseID)
    expect(posthog.captureImmediate).toHaveBeenCalledTimes(1)
  })

  test('keeps the tracked context when streaming retrieval establishment fails', async () => {
    const fetchMock = createStreamingFetchMock([], { streamError: new Error('stream unavailable') })
    const posthog = createPostHogMock()
    const client = createClient(fetchMock, posthog)
    await createTrackedBackgroundResponse(client)

    await expect(client.responses.retrieve(responseID, { stream: true })).rejects.toThrow()

    expect(posthog.captureImmediate).not.toHaveBeenCalled()
    expect((await client.responses.retrieve(responseID)).status).toBe('completed')
    await client.responses.retrieve(responseID)
    expect(posthog.captureImmediate).toHaveBeenCalledTimes(1)
  })
})

describe('BackgroundResponseTracker', () => {
  test('evicts the oldest context when its bound is exceeded', () => {
    const tracker = new BackgroundResponseTracker<number>(2)

    tracker.set('first', 1)
    tracker.set('second', 2)
    tracker.set('third', 3)

    expect(tracker.get('first')).toBeUndefined()
    expect(tracker.take('second')).toBe(2)
    expect(tracker.take('second')).toBeUndefined()
    expect(tracker.get('third')).toBe(3)
  })
})
