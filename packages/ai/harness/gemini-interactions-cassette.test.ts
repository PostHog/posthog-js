import { GoogleGenAI } from '@google/genai'
import { execFile } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { startRecorder, startReplay } from './cassette'
import { startCollector } from './collector'
import { geminiInteractionStreamChunks } from './gemini-interactions-protocol'

const model = 'gemini-synthetic'
const request = { model, input: 'Reply with a short greeting.', store: false }
const usage = { total_input_tokens: 7, total_output_tokens: 3, total_tokens: 10 }
const response = {
  id: 'v1_synthetic',
  model,
  status: 'completed',
  steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Hello.' }] }],
  usage,
}
const frame = (name: string, value: unknown) => `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`
const stream = [
  frame('interaction.created', {
    event_type: 'interaction.created',
    interaction: { id: 'v1_synthetic', model, status: 'in_progress' },
  }),
  frame('step.start', { event_type: 'step.start', index: 0, step: { type: 'model_output' } }),
  frame('step.delta', { event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'Hello.' } }),
  frame('step.stop', { event_type: 'step.stop', index: 0 }),
  frame('interaction.completed', {
    event_type: 'interaction.completed',
    interaction: { id: 'v1_synthetic', status: 'completed', usage },
  }),
  'event: done\ndata: [DONE]\n\n',
]
const provenance = { source: 'synthetic' as const, recordedAt: '2026-09-24T00:00:00Z', providerSdkVersion: '2.18.0' }

let directory: string
let path: string
const cleanup: Array<() => Promise<void>> = []

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ai-gemini-interactions-'))
  path = join(directory, 'interaction.json')
})

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  await rm(directory, { recursive: true, force: true })
})

async function upstream(respond: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer((incoming, outgoing) => {
    incoming.resume()
    respond(incoming, outgoing)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing upstream address')
  const close = async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) =>
        error && (!('code' in error) || error.code !== 'ERR_SERVER_NOT_RUNNING') ? reject(error) : resolve()
      )
    )
  }
  cleanup.push(close)
  return { url: `http://127.0.0.1:${address.port}`, close }
}

function client(url: string) {
  return new GoogleGenAI({
    apiKey: 'fake-gemini-key',
    httpOptions: { baseUrl: url, apiVersion: 'v1beta', timeout: 2000, retryOptions: { attempts: 1 } },
  })
}

it('accepts the empty stream interaction ID returned for store:false', () => {
  const stateless = stream.map((chunk) => chunk.replaceAll('v1_synthetic', '')).join('')
  expect(geminiInteractionStreamChunks(stateless, JSON.parse, () => {})).toHaveLength(stream.length)
})

it('records and replays the real SDK Interactions JSON and step stream without saving credentials', async () => {
  const seen: Array<{ path: string | undefined; body: unknown }> = []
  const source = await upstream(async (incoming, outgoing) => {
    const chunks: Buffer[] = []
    for await (const chunk of incoming) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    seen.push({ path: incoming.url, body })
    outgoing.writeHead(200, { 'content-type': body.stream ? 'text/event-stream' : 'application/json' })
    if (body.stream) {
      outgoing.write(stream.join(''))
      setTimeout(() => outgoing.end(), 30)
    } else {
      outgoing.end(JSON.stringify(response))
    }
  })
  const recorder = await startRecorder({ path, upstreamURL: source.url, provenance })
  cleanup.push(() => recorder.close())
  const unary = await client(recorder.url).interactions.create(request)
  const events = []
  for await (const event of await client(recorder.url).interactions.create({ ...request, stream: true }))
    events.push(event)
  expect(unary.output_text).toBe('Hello.')
  expect(events.map((event) => event.event_type)).toEqual([
    'interaction.created',
    'step.start',
    'step.delta',
    'step.stop',
    'interaction.completed',
  ])
  expect(seen).toEqual([
    { path: '/v1beta/interactions', body: request },
    { path: '/v1beta/interactions', body: { ...request, stream: true } },
  ])
  await recorder.finish()
  await recorder.close()
  await source.close()

  const replay = await startReplay({ path })
  cleanup.push(() => replay.close())
  expect((await client(replay.url).interactions.create(request)).output_text).toBe(unary.output_text)
  const replayed = []
  for await (const event of await client(replay.url).interactions.create({ ...request, stream: true }))
    replayed.push(event)
  expect(replayed).toEqual(events)
  await replay.finish()
  const saved = await readFile(path, 'utf8')
  expect(saved).not.toContain('fake-gemini-key')
  expect(saved).not.toContain('x-goog-api-key')
  expect(
    JSON.parse(saved).interactions.map((item: { response: { body: { kind: string } } }) => item.response.body.kind)
  ).toEqual(['json', 'sse'])

  const wrapperReplay = await startReplay({ path })
  cleanup.push(() => wrapperReplay.close())
  const collector = await startCollector()
  cleanup.push(() => collector.close())
  for (const params of [request, { ...request, stream: true }]) {
    const result = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('./scenarios/gemini.mjs', import.meta.url))],
      {
        env: {
          PROVIDER_URL: wrapperReplay.url,
          COLLECTOR_URL: collector.url,
          GEMINI_OPERATION: 'interactions.create',
          GEMINI_REQUEST: JSON.stringify({ ...params, posthogTraceId: 'interaction-cassette-trace' }),
        },
        timeout: 10000,
      }
    )
    const caller = JSON.parse(result.stdout)
    if ('stream' in params)
      expect(caller.map((event: { event_type: string }) => event.event_type)).toEqual(
        events.map((event) => event.event_type)
      )
    else expect(caller.output_text).toBe('Hello.')
  }
  await wrapperReplay.finish()
  collector.verify()
  expect(collector.events).toHaveLength(2)
  for (const event of collector.events) {
    expect(event).toMatchObject({
      event: '$ai_generation',
      distinct_id: 'cassette-test',
      properties: {
        $ai_provider: 'gemini',
        $ai_model: model,
        $ai_trace_id: 'interaction-cassette-trace',
        $ai_input_tokens: 7,
        $ai_output_tokens: 3,
        $ai_completion_id: 'v1_synthetic',
      },
    })
  }
})

it.each([
  ['truncated', stream.slice(0, -1).join('')],
  ['event after completion', stream.slice(0, -1).join('') + stream[2] + stream.at(-1)],
  [
    'credential split across deltas',
    [
      ...stream.slice(0, 2),
      frame('step.delta', { event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'fake-gemini-' } }),
      frame('step.delta', { event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'key' } }),
      ...stream.slice(3),
    ].join(''),
  ],
])('rejects %s without writing a cassette', async (_name, body) => {
  const source = await upstream((_incoming, outgoing) => {
    outgoing.writeHead(200, { 'content-type': 'text/event-stream' }).end(body)
  })
  const recorder = await startRecorder({ path, upstreamURL: source.url, provenance })
  cleanup.push(() => recorder.close())
  try {
    for await (const _event of await client(recorder.url).interactions.create({ ...request, stream: true })) {
      // Consume the stream so the recorder can validate its complete response.
    }
  } catch {
    // A rejected recorder stream may also reject in the provider SDK.
  }
  await expect(recorder.finish()).rejects.toThrow()
  await expect(readFile(path, 'utf8')).rejects.toThrow()
})
