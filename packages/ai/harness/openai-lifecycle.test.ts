import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { startCollector } from './collector'

const model = 'synthetic-model'
const completed = {
  id: 'resp_synthetic',
  object: 'response',
  model,
  status: 'completed',
  background: true,
  created_at: 100,
  completed_at: 102,
  error: null,
  output: [
    {
      type: 'message',
      id: 'msg_synthetic',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'Hello.', annotations: [] }],
    },
  ],
  usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 },
}
const pending = { ...completed, status: 'queued', completed_at: null, output: [], usage: null }
const data = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`
const responseEvent = (type: string, response: unknown) => `event: ${type}\n${data({ type, response })}`
type Reply = { method?: string; path: string; body: unknown; status?: number; sse?: boolean; holdOpen?: boolean }

async function run(scenario: string, replies: Reply[], env: Record<string, string> = {}) {
  const collector = await startCollector()
  const received: Array<{ method?: string; path?: string; body: string }> = []
  const errors: string[] = []
  const provider = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const reply = replies[received.length]
    received.push({ method: request.method, path: request.url, body: Buffer.concat(chunks).toString('utf8') })
    if (!reply || request.method !== (reply.method ?? 'POST') || request.url !== reply.path) {
      errors.push('Unexpected provider request')
      response.writeHead(500).end('{}')
      return
    }
    response.writeHead(reply.status ?? 200, { 'content-type': reply.sse ? 'text/event-stream' : 'application/json' })
    const body = reply.sse ? reply.body : JSON.stringify(reply.body)
    if (reply.holdOpen) response.write(body)
    else response.end(body)
  })
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
  const address = provider.address()
  if (!address || typeof address === 'string') throw new Error('Missing provider address')
  try {
    const child = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('./scenarios/openai-lifecycle.mjs', import.meta.url))],
      {
        env: {
          PROVIDER_URL: `http://127.0.0.1:${address.port}`,
          COLLECTOR_URL: collector.url,
          SCENARIO: scenario,
          ...env,
        },
        timeout: 10000,
      }
    )
    expect(errors).toEqual([])
    expect(received).toHaveLength(replies.length)
    collector.verify()
    return { result: JSON.parse(child.stdout), events: collector.events, received }
  } finally {
    provider.closeAllConnections()
    await new Promise<void>((resolve, reject) => provider.close((error) => (error ? reject(error) : resolve())))
    await collector.close()
  }
}

it('captures a streamed background completion once using the original create identity', async () => {
  const { result, events, received } = await run(
    'background',
    [
      { path: '/v1/responses', body: pending },
      {
        method: 'GET',
        path: '/v1/responses/resp_synthetic?stream=true',
        sse: true,
        body:
          responseEvent('response.created', { ...pending, status: 'in_progress' }) +
          responseEvent('response.completed', completed),
      },
      { method: 'GET', path: '/v1/responses/resp_synthetic', body: completed },
      { method: 'GET', path: '/v1/responses/resp_synthetic', body: completed },
    ],
    { EXPECT_EVENTS: '1' }
  )
  expect(result.pending).toBe('queued')
  expect(result.retrieved).toEqual(['completed', 'completed'])
  expect(result.events.at(-1).response).toEqual(completed)
  expect(JSON.parse(received[0].body)).toEqual({ model, input: 'Say hello.', background: true })
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({
    event: '$ai_generation',
    distinct_id: 'original-user',
    properties: {
      $ai_provider: 'openai',
      $ai_model: model,
      $ai_trace_id: 'original-trace',
      scenario: 'original-request',
      $ai_input_tokens: 7,
      $ai_output_tokens: 3,
      $ai_latency: 2,
      $ai_output_choices: [{ role: 'assistant', content: [{ type: 'text', text: 'Hello.' }] }],
    },
  })
})

const surfaces = [
  ['chat', '/v1/chat/completions'],
  ['responses', '/v1/responses'],
  ['embeddings', '/v1/embeddings'],
  ['audio', '/v1/audio/transcriptions'],
] as const
const providerError = {
  error: { message: 'Synthetic rate limit', type: 'rate_limit_error', code: 'rate_limit_exceeded' },
}
it.each(surfaces)('preserves %s HTTP errors and captures one failed request', async (surface, path) => {
  const { result, events } = await run('error', [{ path, status: 429, body: providerError }], {
    SURFACE: surface,
    EXPECT_EVENTS: '1',
  })
  expect(result.error).toEqual({ status: 429, isRateLimitError: true })
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({
    event: surface === 'embeddings' ? '$ai_embedding' : '$ai_generation',
    distinct_id: 'original-user',
    properties: {
      $ai_provider: 'openai',
      $ai_model: model,
      $ai_is_error: true,
      $ai_http_status: 429,
      $ai_trace_id: 'original-trace',
    },
  })
})

it.each(surfaces.filter(([surface]) => surface !== 'embeddings'))(
  'preserves an initial %s HTTP error before a stream exists',
  async (surface, path) => {
    const { result } = await run('error', [{ path, status: 429, body: providerError }], {
      SURFACE: surface,
      STREAM: '1',
    })
    // Initial HTTP rejection does not reach the streaming analytics tee. This checks caller delivery only.
    expect(result.error).toEqual({ status: 429, isRateLimitError: true })
  }
)

it('keeps interleaved Chat tool arguments associated with their tool IDs', async () => {
  const chunk = (delta: unknown, finish_reason: string | null = null) => ({
    id: 'chatcmpl_synthetic',
    object: 'chat.completion.chunk',
    model,
    created: 100,
    choices: [{ index: 0, delta, finish_reason }],
  })
  const body =
    [
      chunk({
        tool_calls: [
          { index: 0, id: 'call_a', type: 'function', function: { name: 'lookup', arguments: '{"city":"' } },
          { index: 1, id: 'call_b', type: 'function', function: { name: 'lookup', arguments: '{"city":"' } },
        ],
      }),
      chunk({ tool_calls: [{ index: 1, function: { arguments: 'Oslo' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: 'Lima' } }] }),
      chunk({
        tool_calls: [
          { index: 0, function: { arguments: '"}' } },
          { index: 1, function: { arguments: '"}' } },
        ],
      }),
      chunk({}, 'tool_calls'),
      {
        id: 'chatcmpl_synthetic',
        object: 'chat.completion.chunk',
        model,
        created: 100,
        choices: [],
        usage: { prompt_tokens: 7, completion_tokens: 12, total_tokens: 19 },
      },
    ]
      .map(data)
      .join('') + 'data: [DONE]\n\n'
  const { result, events } = await run('tools', [{ path: '/v1/chat/completions', body, sse: true }], {
    EXPECT_EVENTS: '1',
  })
  expect(result.events).toHaveLength(6)
  expect(result.events[1].choices[0].delta.tool_calls).toEqual([{ index: 1, function: { arguments: 'Oslo' } }])
  expect(events).toHaveLength(1)
  expect(events[0].properties).toMatchObject({
    $ai_stop_reason: 'tool_calls',
    $ai_input_tokens: 7,
    $ai_output_tokens: 12,
    $ai_output_choices: [
      {
        role: 'assistant',
        content: [
          { type: 'function', id: 'call_a', function: { name: 'lookup', arguments: '{"city":"Lima"}' } },
          { type: 'function', id: 'call_b', function: { name: 'lookup', arguments: '{"city":"Oslo"}' } },
        ],
      },
    ],
  })
})

const failure = { code: 'server_error', message: 'Synthetic provider failure' }
it.each([false, true])(
  'captures an HTTP 200 failed Response (stream: %s) without changing its caller contract',
  async (stream) => {
    const failed = { ...completed, background: false, status: 'failed', error: failure, output: [] }
    const { result, events } = await run(
      stream ? 'failed-response-stream' : 'failed-response',
      [
        {
          path: '/v1/responses',
          sse: stream,
          body: stream
            ? responseEvent('response.created', { ...pending, background: false }) +
              responseEvent('response.failed', failed)
            : failed,
        },
      ],
      { EXPECT_EVENTS: '1' }
    )
    if (stream) expect(result.events.at(-1)).toEqual({ type: 'response.failed', response: failed })
    else expect(result).toEqual({ status: 'failed', error: failure })
    expect(events).toHaveLength(1)
    expect(events[0].properties).toMatchObject({
      $ai_is_error: true,
      $ai_http_status: 200,
      $ai_stop_reason: 'failed',
      $ai_input_tokens: 7,
      $ai_output_tokens: 3,
      $ai_error: JSON.stringify(failure),
    })
  }
)

const partialChat = {
  id: 'chatcmpl_partial',
  object: 'chat.completion.chunk',
  model,
  created: 100,
  choices: [{ index: 0, delta: { role: 'assistant', content: 'Partial.' }, finish_reason: null }],
  usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
}
it('preserves a Chat midstream error and records the usage received before it', async () => {
  const { result, events } = await run(
    'stream-error',
    [
      {
        path: '/v1/chat/completions',
        sse: true,
        body: data(partialChat) + data({ error: { message: 'Synthetic stream failure', type: 'server_error' } }),
      },
    ],
    { EXPECT_EVENTS: '1' }
  )
  expect(result).toEqual({ events: [partialChat], error: { isAPIError: true, message: 'Synthetic stream failure' } })
  expect(events).toHaveLength(1)
  expect(events[0].properties).toMatchObject({ $ai_is_error: true, $ai_input_tokens: 7, $ai_output_tokens: 2 })
})

it('allows the caller to abort after the first Chat chunk without waiting for stream completion', async () => {
  const { result } = await run('abort', [
    { path: '/v1/chat/completions', sse: true, holdOpen: true, body: data(partialChat) },
  ])
  expect(result).toEqual({ events: [partialChat], aborted: true })
})
