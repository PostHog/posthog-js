import OpenAI from 'openai'
import { createServer, request as httpRequest, type IncomingMessage } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startRecorder, startReplay } from './cassette'
import { openaiStream } from './openai-protocol'

it('accepts the live transcription DONE sentinel after transcript.text.done', () => {
  const stream = 'data: {"type":"transcript.text.done","text":"Hello."}\n\ndata: [DONE]\n\n'
  expect(openaiStream(stream, '/v1/audio/transcriptions', () => undefined)).toHaveLength(2)
  expect(() => openaiStream(`${stream}data: [DONE]\n\n`, '/v1/audio/transcriptions', () => undefined)).toThrow()
  expect(() => openaiStream('data: [DONE]\n\n', '/v1/audio/transcriptions', () => undefined)).toThrow()
})

const secret = 'fake-openai-secret'
const model = 'synthetic-model'
const provenance = { source: 'synthetic' as const, recordedAt: '2026-09-19T00:00:00Z', providerSdkVersion: 'test' }
const chatRequest = { model, messages: [{ role: 'user' as const, content: 'Say hello.' }] }
const responseRequest = { model, input: 'Say hello.' }
const usage = { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 }
const completion = {
  id: 'chatcmpl_synthetic',
  object: 'chat.completion',
  created: 1,
  model,
  usage,
  choices: [{ index: 0, message: { role: 'assistant', content: 'Hello.' }, finish_reason: 'stop' }],
}
const response = {
  id: 'resp_synthetic',
  object: 'response',
  created_at: 1,
  model,
  status: 'completed',
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
const data = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
const event = (value: { type: string; [key: string]: unknown }) => `event: ${value.type}\n${data(value)}`
const chatChunk = (delta: Record<string, unknown>, finish_reason: string | null = null) => ({
  id: 'chatcmpl_synthetic',
  object: 'chat.completion.chunk',
  created: 1,
  model,
  choices: [{ index: 0, delta, finish_reason }],
})
const chatStream = [
  data(chatChunk({ role: 'assistant', content: '' })),
  data(chatChunk({ content: 'Hello.' })),
  data(chatChunk({}, 'stop')),
  data({ id: 'chatcmpl_synthetic', object: 'chat.completion.chunk', created: 1, model, choices: [], usage }),
  'data: [DONE]\n\n',
].join('')
const responseStream = (status = 'completed') =>
  [
    event({
      type: 'response.created',
      sequence_number: 0,
      response: { ...response, status: 'in_progress', output: [], usage: null },
    }),
    event({
      type: 'response.output_text.delta',
      sequence_number: 1,
      item_id: 'msg_synthetic',
      output_index: 0,
      content_index: 0,
      delta: 'Hello.',
    }),
    event({
      type: `response.${status}`,
      sequence_number: 2,
      response: {
        ...response,
        status,
        ...(status === 'incomplete' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
      },
    }),
  ].join('')
async function collect(value: AsyncIterable<unknown>): Promise<unknown[]> {
  const events = []
  for await (const item of value) events.push(item)
  return events
}
const audioRequest = () => ({
  model: 'gpt-4o-mini-transcribe',
  file: new File([Uint8Array.from([82, 73, 70, 70, 0, 1, 2, 3])], 'artificial.wav', { type: 'audio/wav' }),
})
type Scenario = { name: string; contentType: string; body: string; run: (client: OpenAI) => Promise<unknown> }
const scenarios: Scenario[] = [
  {
    name: 'Chat JSON',
    contentType: 'application/json',
    body: JSON.stringify(completion),
    run: (client) => client.chat.completions.create(chatRequest),
  },
  {
    name: 'Chat SSE with final usage',
    contentType: 'text/event-stream',
    body: chatStream,
    run: async (client) =>
      collect(
        await client.chat.completions.create({ ...chatRequest, stream: true, stream_options: { include_usage: true } })
      ),
  },
  {
    name: 'Responses JSON',
    contentType: 'application/json',
    body: JSON.stringify(response),
    run: (client) => client.responses.create(responseRequest),
  },
  ...['completed', 'incomplete'].map((status): Scenario => ({
    name: `Responses SSE ${status}`,
    contentType: 'text/event-stream',
    body: responseStream(status),
    run: async (client) => collect(await client.responses.create({ ...responseRequest, stream: true })),
  })),
  {
    name: 'embeddings JSON',
    contentType: 'application/json',
    body: JSON.stringify({
      object: 'list',
      model,
      data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2] }],
      usage: { prompt_tokens: 3, total_tokens: 3 },
    }),
    run: (client) => client.embeddings.create({ model, input: 'Hello.', encoding_format: 'float' }),
  },
  {
    name: 'multipart transcription JSON',
    contentType: 'application/json',
    body: JSON.stringify({
      text: 'Hello.',
      usage: { type: 'tokens', input_tokens: 7, output_tokens: 3, total_tokens: 10 },
    }),
    run: (client) => client.audio.transcriptions.create(audioRequest()),
  },
  {
    name: 'multipart transcription text',
    contentType: 'text/plain',
    body: 'Hello.',
    run: (client) => client.audio.transcriptions.create({ ...audioRequest(), response_format: 'text' }),
  },
  {
    name: 'multipart transcription SSE',
    contentType: 'text/event-stream',
    body:
      event({ type: 'transcript.text.delta', delta: 'Hello.' }) +
      event({
        type: 'transcript.text.done',
        text: 'Hello.',
        usage: { type: 'tokens', input_tokens: 7, output_tokens: 3, total_tokens: 10 },
      }),
    run: async (client) => collect(await client.audio.transcriptions.create({ ...audioRequest(), stream: true })),
  },
  {
    name: 'background retrieve',
    contentType: 'application/json',
    body: JSON.stringify(response),
    run: (client) => client.responses.retrieve('resp_synthetic'),
  },
  {
    name: 'background retrieve stream',
    contentType: 'text/event-stream',
    body: responseStream(),
    run: async (client) => collect(await client.responses.retrieve('resp_synthetic', { stream: true })),
  },
  {
    name: 'background cancel',
    contentType: 'application/json',
    body: JSON.stringify({ ...response, status: 'cancelled', output: [] }),
    run: (client) => client.responses.cancel('resp_synthetic'),
  },
]

describe('OpenAI provider cassettes', () => {
  let directory: string
  let path: string
  let cleanup: Array<() => Promise<void>>
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'openai-cassette-'))
    path = join(directory, 'recording.json')
    cleanup = []
  })
  afterEach(async () => {
    for (const close of cleanup.reverse()) await close()
    await rm(directory, { recursive: true, force: true })
  })
  async function upstream(
    body: string,
    contentType = 'application/json',
    inspect?: (request: IncomingMessage) => void
  ) {
    const server = createServer((request, reply) => {
      inspect?.(request)
      request.resume()
      reply.writeHead(200, { 'content-type': contentType, 'x-api-key': 'response-secret' }).end(body)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing upstream address')
    const close = async () => {
      if (!server.listening) return
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
    cleanup.push(close)
    return { url: `http://127.0.0.1:${address.port}`, close }
  }
  function client(url: string) {
    return new OpenAI({ apiKey: secret, baseURL: `${url}/v1`, maxRetries: 0, timeout: 2000, logLevel: 'off' })
  }
  async function record(scenario: Scenario) {
    let authorization: string | undefined
    const source = await upstream(scenario.body, scenario.contentType, (request) => {
      authorization = request.headers.authorization
    })
    const recorder = await startRecorder({ path, upstreamURL: source.url, provenance })
    cleanup.push(() => recorder.close())
    const received = await scenario.run(client(recorder.url))
    await recorder.finish()
    expect(authorization).toBe(`Bearer ${secret}`)
    await recorder.close()
    await source.close()
    return received
  }
  it.each(scenarios)('records and replays $name through the real SDK with upstream stopped', async (scenario) => {
    const recorded = await record(scenario)
    const replay = await startReplay({ path })
    cleanup.push(() => replay.close())
    expect(await scenario.run(client(replay.url))).toEqual(recorded)
    await replay.finish()
    const saved = await readFile(path, 'utf8')
    expect(saved).not.toContain(secret)
    expect(saved).not.toContain('response-secret')
    expect(saved).not.toContain('authorization')
  })
  it('retains request mismatches after callers catch SDK errors', async () => {
    await record(scenarios[0])
    const replay = await startReplay({ path })
    cleanup.push(() => replay.close())
    await expect(client(replay.url).chat.completions.create({ ...chatRequest, model: 'wrong' })).rejects.toThrow()
    await expect(replay.finish()).rejects.toThrow('mismatch failure')
  })
  it('accepts the null error field in successful Responses JSON', async () => {
    const scenario = { ...scenarios[2], body: JSON.stringify({ ...response, error: null }) }
    expect(await record(scenario)).toMatchObject({ status: 'completed', error: null })
  })
  it('records diarized transcript segments before the final transcript', async () => {
    const scenario = {
      ...scenarios[8],
      body:
        event({ type: 'transcript.text.segment', text: 'Hello.', speaker: 'A', start: 0, end: 1 }) +
        event({ type: 'transcript.text.done', text: 'Hello.' }),
    }
    const recorded = await record(scenario)
    const replay = await startReplay({ path })
    cleanup.push(() => replay.close())
    expect(await scenario.run(client(replay.url))).toEqual(recorded)
    await replay.finish()
  })
  it.each([
    [true, 'application/json', JSON.stringify(completion)],
    [false, 'text/event-stream', chatStream],
  ] as const)('rejects stream=%s with response type %s', async (stream, contentType, body) => {
    const source = await upstream(body, contentType)
    const recorder = await startRecorder({ path, upstreamURL: source.url, provenance })
    cleanup.push(() => recorder.close())
    const reply = await fetch(`${recorder.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...chatRequest, stream }),
    })
    await reply.text().catch(() => undefined)
    await expect(recorder.finish()).rejects.toThrow('response failure')
    await expect(readFile(path)).rejects.toThrow()
  })
  it('rejects a GET request body', async () => {
    const source = await upstream(JSON.stringify(response))
    const recorder = await startRecorder({ path, upstreamURL: source.url, provenance })
    cleanup.push(() => recorder.close())
    await new Promise<void>((resolve, reject) => {
      const request = httpRequest(
        `${recorder.url}/v1/responses/resp_synthetic`,
        { method: 'GET', headers: { 'content-length': '2' } },
        (reply) => {
          reply.resume()
          reply.on('end', resolve)
        }
      )
      request.on('error', reject)
      request.end('{}')
    })
    await expect(recorder.finish()).rejects.toThrow('request failure')
    await expect(readFile(path)).rejects.toThrow()
  })
  it('rejects a known credential in raw multipart file bytes before hashing them', async () => {
    const source = await upstream(JSON.stringify({ text: 'Hello.' }))
    const recorder = await startRecorder({ path, upstreamURL: source.url, provenance })
    cleanup.push(() => recorder.close())
    await client(recorder.url)
      .audio.transcriptions.create({ ...audioRequest(), file: new File([secret], 'artificial.wav') })
      .catch(() => undefined)
    await expect(recorder.finish()).rejects.toThrow('secret failure')
    await expect(readFile(path)).rejects.toThrow()
  })
  it.each([
    '/v1/images/generations',
    '/v1/responses/resp_synthetic?unexpected=true',
    '/v1/responses/resp_synthetic?stream=true&stream=false',
  ])('rejects unsupported route or query %s', async (route) => {
    const source = await upstream(JSON.stringify(response))
    const recorder = await startRecorder({ path, upstreamURL: source.url, provenance })
    cleanup.push(() => recorder.close())
    const reply = await fetch(`${recorder.url}${route}`)
    await reply.text()
    await expect(recorder.finish()).rejects.toThrow('request failure')
  })
  it.each([
    'https://api.anthropic.com',
    'https://api.openai.com.example.com',
    'https://api.openai.com/v1',
    'https://api.openai.com/?secret=hidden',
    'http://api.openai.com',
  ])('rejects unsupported OpenAI origin %s', async (upstreamURL) => {
    await expect(startRecorder({ path, upstreamURL, provenance: { ...provenance, source: 'openai' } })).rejects.toThrow(
      'Unsupported recording upstream'
    )
  })
  it('does not replay a Chat recording for a Responses request', async () => {
    await record(scenarios[0])
    const replay = await startReplay({ path })
    cleanup.push(() => replay.close())
    await expect(client(replay.url).responses.create(responseRequest)).rejects.toThrow()
    await expect(replay.finish()).rejects.toThrow('mismatch failure')
  })
  it.each(['file', 'filename', 'mime', 'model'] as const)(
    'matches multipart %s rather than its random boundary',
    async (changed) => {
      await record(scenarios[6])
      const replay = await startReplay({ path })
      cleanup.push(() => replay.close())
      const request = audioRequest()
      if (changed === 'file')
        request.file = new File(['different audio bytes'], 'artificial.wav', { type: 'audio/wav' })
      else if (changed === 'filename') request.file = new File([request.file], 'different.wav', { type: 'audio/wav' })
      else if (changed === 'mime')
        request.file = new File([request.file], 'artificial.wav', { type: 'application/octet-stream' })
      else request.model = 'different-model'
      await expect(client(replay.url).audio.transcriptions.create(request)).rejects.toThrow()
      await expect(replay.finish()).rejects.toThrow('mismatch failure')
    }
  )
  const escapedSecret = [...secret]
    .map((character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
    .join('')
  const toolStream = (argumentsParts: string[]) =>
    [
      data(
        chatChunk({
          tool_calls: [
            { index: 0, id: 'call_synthetic', type: 'function', function: { name: 'lookup', arguments: '' } },
          ],
        })
      ),
      ...argumentsParts.map((arguments_) =>
        data(chatChunk({ tool_calls: [{ index: 0, function: { arguments: arguments_ } }] }))
      ),
      data(chatChunk({}, 'tool_calls')),
      'data: [DONE]\n\n',
    ].join('')
  it('records fragmented tool arguments without dropping JSON escapes', async () => {
    const scenario = { ...scenarios[1], body: toolStream(['{"city":"S', '\\u00e3o Paulo"}']) }
    const recorded = await record(scenario)
    const replay = await startReplay({ path })
    cleanup.push(() => replay.close())
    expect(await scenario.run(client(replay.url))).toEqual(recorded)
    await replay.finish()
  })
  it.each([
    ['Chat missing DONE', chatStream.replace('data: [DONE]\n\n', '')],
    ['Chat malformed JSON', 'data: {invalid}\n\ndata: [DONE]\n\n'],
    ['Chat incomplete frame', chatStream.trimEnd()],
    ['Chat unfinished tool arguments', toolStream(['{"city":'])],
    ['Chat provider error', data({ error: { message: 'synthetic failure' } }) + 'data: [DONE]\n\n'],
  ])('rejects %s and preserves an existing file', async (_name, body) => {
    await writeFile(path, 'previous recording')
    const source = await upstream(body, 'text/event-stream')
    const recorder = await startRecorder({ path, upstreamURL: source.url, provenance })
    cleanup.push(() => recorder.close())
    await scenarios[1].run(client(recorder.url)).catch(() => undefined)
    await expect(recorder.finish()).rejects.toThrow('stream failure')
    expect(await readFile(path, 'utf8')).toBe('previous recording')
  })
  it.each([
    [
      'JSON decoded secret',
      'application/json',
      JSON.stringify(completion).replace('Hello.', escapedSecret),
      scenarios[0],
    ],
    [
      'JSON duplicate key hides escaped secret',
      'application/json',
      JSON.stringify(completion).replace('"content":"Hello."', `"content":"${escapedSecret}","content":"Hello."`),
      scenarios[0],
    ],
    [
      'split text secret',
      'text/event-stream',
      data(chatChunk({ content: 'fake-openai-' })) +
        data(chatChunk({ content: 'secret' }, 'stop')) +
        'data: [DONE]\n\n',
      scenarios[1],
    ],
    ['escaped tool secret', 'text/event-stream', toolStream([`{"city":"${escapedSecret}"}`]), scenarios[1]],
    [
      'duplicate tool key hides escaped secret',
      'text/event-stream',
      toolStream([`{"city":"${escapedSecret}","city":"safe"}`]),
      scenarios[1],
    ],
    [
      'escaped tool credential key',
      'text/event-stream',
      toolStream(['{"api\\u005fkey":"private-value"}']),
      scenarios[1],
    ],
  ] as const)('rejects %s without exposing the secret', async (_name, contentType, body, scenario) => {
    const source = await upstream(body, contentType)
    const recorder = await startRecorder({ path, upstreamURL: source.url, provenance })
    cleanup.push(() => recorder.close())
    await scenario.run(client(recorder.url)).catch(() => undefined)
    await expect(recorder.finish()).rejects.toThrow('secret failure')
    await expect(readFile(path)).rejects.toThrow()
  })
  it.each([
    ['missing terminal response', responseStream().split('event: response.completed')[0]],
    ['failed response', responseStream('failed')],
    ['event after completion', responseStream() + event({ type: 'response.output_text.delta', delta: 'late' })],
  ])('rejects Responses SSE with %s', async (_name, body) => {
    const source = await upstream(body, 'text/event-stream')
    const recorder = await startRecorder({ path, upstreamURL: source.url, provenance })
    cleanup.push(() => recorder.close())
    await scenarios[3].run(client(recorder.url)).catch(() => undefined)
    await expect(recorder.finish()).rejects.toThrow('stream failure')
    await expect(readFile(path)).rejects.toThrow()
  })
  it('rejects transcription SSE without transcript.text.done', async () => {
    const source = await upstream(event({ type: 'transcript.text.delta', delta: 'Hello.' }), 'text/event-stream')
    const recorder = await startRecorder({ path, upstreamURL: source.url, provenance })
    cleanup.push(() => recorder.close())
    await scenarios[8].run(client(recorder.url)).catch(() => undefined)
    await expect(recorder.finish()).rejects.toThrow('stream failure')
    await expect(readFile(path)).rejects.toThrow()
  })
  it.each([
    [
      'Responses text',
      scenarios[3],
      responseStream().replace(
        'event: response.output_text.delta',
        event({
          type: 'response.output_text.delta',
          item_id: 'msg_synthetic',
          output_index: 0,
          content_index: 0,
          delta: 'fake-openai-',
        }) +
          event({
            type: 'response.output_text.delta',
            item_id: 'msg_synthetic',
            output_index: 0,
            content_index: 0,
            delta: 'secret',
          }) +
          'event: response.output_text.delta'
      ),
    ],
    [
      'Responses tool arguments',
      scenarios[3],
      responseStream().replace(
        'event: response.output_text.delta',
        event({
          type: 'response.function_call_arguments.delta',
          item_id: 'fc_synthetic',
          output_index: 0,
          delta: `{"city":"${escapedSecret}"}`,
        }) + 'event: response.output_text.delta'
      ),
    ],
    [
      'transcription text',
      scenarios[8],
      event({ type: 'transcript.text.delta', delta: 'fake-openai-' }) +
        event({ type: 'transcript.text.delta', delta: 'secret' }) +
        event({ type: 'transcript.text.done', text: 'Hello.' }),
    ],
  ] as const)('rejects a secret split or escaped in %s', async (_name, scenario, body) => {
    const source = await upstream(body, 'text/event-stream')
    const recorder = await startRecorder({ path, upstreamURL: source.url, provenance })
    cleanup.push(() => recorder.close())
    await scenario.run(client(recorder.url)).catch(() => undefined)
    await expect(recorder.finish()).rejects.toThrow('secret failure')
    await expect(readFile(path)).rejects.toThrow()
  })
})
