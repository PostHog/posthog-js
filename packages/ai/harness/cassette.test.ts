import Anthropic from '@anthropic-ai/sdk'
import { createServer, type ServerResponse } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startRecorder, startReplay } from './cassette'

const request = {
  model: 'synthetic-model',
  max_tokens: 32,
  messages: [{ role: 'user' as const, content: 'Say hello.' }],
}
const provenance = { source: 'synthetic' as const, recordedAt: '2026-09-15T00:00:00Z', providerSdkVersion: 'test' }
const event = (value: Record<string, unknown>) => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`
const chunks = [
  event({
    type: 'message_start',
    message: {
      id: 'msg_synthetic',
      type: 'message',
      role: 'assistant',
      model: request.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 7, output_tokens: 0, cache_read_input_tokens: 11, cache_creation_input_tokens: 13 },
    },
  }),
  event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
  event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello.' } }),
  event({ type: 'content_block_stop', index: 0 }),
  event({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 3 },
  }),
  event({ type: 'message_stop' }),
]

describe('provider cassettes', () => {
  let directory: string
  let path: string
  let cleanup: Array<() => Promise<void>>

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ai-cassette-'))
    path = join(directory, 'stream.json')
    cleanup = []
  })

  afterEach(async () => {
    for (const close of cleanup.reverse()) await close()
    await rm(directory, { recursive: true, force: true })
  })

  async function upstream(
    respond: (response: ServerResponse) => void = (response) => response.end(chunks.join('')),
    status = 200,
    headers: Record<string, string> = {}
  ) {
    const server = createServer((incoming, response) => {
      incoming.resume()
      response.writeHead(status, {
        'content-type': 'text/event-stream',
        'x-api-key': 'response-secret',
        ...headers,
      })
      respond(response)
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

  function client(url: string, apiKey = 'fake-provider-secret') {
    return new Anthropic({ apiKey, baseURL: url, maxRetries: 0, timeout: 2000 })
  }

  async function consume(url: string) {
    const stream = await client(url).messages.create({ ...request, stream: true })
    const events = []
    for await (const item of stream) events.push(item)
    return events
  }

  async function record() {
    const source = await upstream()
    const recorder = await startRecorder({ path, upstreamURL: source.url, provenance })
    cleanup.push(() => recorder.close())
    const result = await consume(recorder.url)
    await recorder.finish()
    await recorder.close()
    await source.close()
    return result
  }

  it('records real SDK traffic and replays after the upstream has stopped', async () => {
    const recorded = await record()
    const replay = await startReplay({ path })
    cleanup.push(() => replay.close())
    expect(await consume(replay.url)).toEqual(recorded)
    await replay.finish()
    const saved = await readFile(path, 'utf8')
    expect(JSON.parse(saved)).toMatchObject({ formatVersion: 1, provenance })
    expect(saved).not.toContain('fake-provider-secret')
    expect(saved).not.toContain('response-secret')
    const start = recorded.find((item) => item.type === 'message_start')
    expect(start?.type === 'message_start' && start.message.usage.cache_read_input_tokens).toBe(11)
  })

  it('forwards the first delta before the upstream finishes', async () => {
    let release: () => void = () => {}
    const source = await upstream((response) => {
      response.write(chunks.slice(0, 3).join(''))
      release = () => response.end(chunks.slice(3).join(''))
    })
    const recorder = await startRecorder({ path, upstreamURL: source.url, provenance })
    cleanup.push(() => recorder.close())
    const stream = await client(recorder.url).messages.create({ ...request, stream: true })
    let sawDelta = false
    try {
      for await (const item of stream) {
        if (item.type === 'content_block_delta') {
          sawDelta = true
          release()
        }
      }
    } finally {
      release()
    }
    expect(sawDelta).toBe(true)
    await recorder.finish()
  }, 5000)

  it('fails closed when the recording is missing', async () => {
    await expect(startReplay({ path })).rejects.toThrow()
  })

  it('retains mismatches even when the caller catches the HTTP error', async () => {
    await record()
    const replay = await startReplay({ path })
    cleanup.push(() => replay.close())
    await expect(
      client(replay.url).messages.create({ ...request, model: 'wrong-model', stream: true })
    ).rejects.toThrow()
    await expect(replay.finish()).rejects.toThrow('Cassette interaction 1: mismatch failure')
  })

  it('rejects an extra request instead of reusing the last response', async () => {
    await record()
    const replay = await startReplay({ path })
    cleanup.push(() => replay.close())
    await consume(replay.url)
    await expect(consume(replay.url)).rejects.toThrow()
    await expect(replay.finish()).rejects.toThrow('Cassette interaction 2: mismatch failure')
  })

  it('rejects unconsumed interactions', async () => {
    await record()
    const replay = await startReplay({ path })
    cleanup.push(() => replay.close())
    await expect(replay.finish()).rejects.toThrow()
  })

  it('compares the selected API version header', async () => {
    await record()
    const replay = await startReplay({ path })
    cleanup.push(() => replay.close())
    await expect(
      client(replay.url).messages.create(
        { ...request, stream: true },
        { headers: { 'anthropic-version': '1900-01-01' } }
      )
    ).rejects.toThrow()
    await expect(replay.finish()).rejects.toThrow()
  })

  it('matches JSON meaning rather than object property order', async () => {
    await record()
    const replay = await startReplay({ path })
    cleanup.push(() => replay.close())
    const stream = await client(replay.url).messages.create({
      stream: true,
      messages: request.messages,
      max_tokens: request.max_tokens,
      model: request.model,
    })
    const received = []
    for await (const item of stream) received.push(item.type)
    expect(received.at(-1)).toBe('message_stop')
    await replay.finish()
  })

  it('preserves a UTF-8 character split across network writes', async () => {
    const text = Buffer.from(chunks.join('').replace('Hello.', 'Olá.'))
    const split = text.indexOf(Buffer.from('á')) + 1
    const source = await upstream((response) => {
      response.write(text.subarray(0, split))
      setImmediate(() => response.end(text.subarray(split)))
    })
    const recorder = await startRecorder({ path, upstreamURL: source.url, provenance })
    cleanup.push(() => recorder.close())
    const result = await consume(recorder.url)
    await recorder.finish()
    await source.close()
    const replay = await startReplay({ path })
    cleanup.push(() => replay.close())
    expect(await consume(replay.url)).toEqual(result)
    expect(await readFile(path, 'utf8')).toContain('Olá.')
    await replay.finish()
  })

  it('does not overwrite an existing cassette on an incomplete stream', async () => {
    await record()
    const original = await readFile(path, 'utf8')
    const source = await upstream((response) => response.end(chunks.slice(0, 3).join('')))
    const recorder = await startRecorder({ path, upstreamURL: source.url, provenance })
    cleanup.push(() => recorder.close())
    await consume(recorder.url).catch(() => undefined)
    await expect(recorder.finish()).rejects.toThrow('Cassette interaction 1: stream failure')
    expect(await readFile(path, 'utf8')).toBe(original)
  })

  it.each([
    ['response', 401, 'provider response containing fake-provider-secret'],
    ['secret', 200, chunks.join('').replace('Hello.', 'fake-provider-secret')],
  ] as const)('reports a safe %s category without exposing the provider payload', async (category, status, body) => {
    const source = await upstream((response) => response.end(body), status)
    const recorder = await startRecorder({ path, upstreamURL: source.url, provenance })
    cleanup.push(() => recorder.close())
    await consume(recorder.url).catch(() => undefined)
    await expect(recorder.finish()).rejects.toThrow(`Cassette interaction 1: ${category} failure`)
    await expect(readFile(path)).rejects.toThrow()
  })

  it('reports a request category without reflecting malformed JSON', async () => {
    await record()
    const replay = await startReplay({ path })
    cleanup.push(() => replay.close())
    const response = await fetch(`${replay.url}/v1/messages`, { method: 'POST', body: 'fake-provider-secret' })
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('Cassette request failed')
    await expect(replay.finish()).rejects.toThrow('Cassette interaction 1: request failure')
  })

  it.each([
    ['duplicate message_start', chunks[0] + chunks.join('')],
    ['data after message_stop', chunks.join('') + event({ type: 'ping' })],
  ])('rejects %s without overwriting', async (_name, stream) => {
    await record()
    const original = await readFile(path, 'utf8')
    const source = await upstream((response) => response.end(stream))
    const recorder = await startRecorder({ path, upstreamURL: source.url, provenance })
    cleanup.push(() => recorder.close())
    await consume(recorder.url).catch(() => undefined)
    await expect(recorder.finish()).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe(original)
  })

  it('rejects a known secret split across upstream chunks without overwriting', async () => {
    await record()
    const original = await readFile(path, 'utf8')
    const source = await upstream((response) => {
      response.write(chunks.slice(0, 2).join(''))
      response.write(
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"split-'
      )
      setImmediate(() => response.end(`secret"}}\n\n${chunks.slice(3).join('')}`))
    })
    const recorder = await startRecorder({ path, upstreamURL: source.url, provenance, secrets: ['split-secret'] })
    cleanup.push(() => recorder.close())
    await consume(recorder.url).catch(() => undefined)
    await expect(recorder.finish()).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe(original)
  })

  it('rejects a terminal event without message_start and preserves the previous recording', async () => {
    await record()
    const original = await readFile(path, 'utf8')
    const source = await upstream((response) => response.end(chunks.at(-1)))
    const recorder = await startRecorder({ path, upstreamURL: source.url, provenance })
    cleanup.push(() => recorder.close())
    await consume(recorder.url).catch(() => undefined)
    await expect(recorder.finish()).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe(original)
  })

  it('rejects malformed cassette data before starting replay', async () => {
    await writeFile(path, JSON.stringify({ formatVersion: 999, interactions: [] }))
    await expect(startReplay({ path })).rejects.toThrow()
  })

  it('rejects a known secret split across separate text delta events', async () => {
    await record()
    const original = await readFile(path, 'utf8')
    const source = await upstream((response) =>
      response.end(
        [
          ...chunks.slice(0, 2),
          event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'split-' } }),
          event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'secret' } }),
          ...chunks.slice(3),
        ].join('')
      )
    )
    const recorder = await startRecorder({ path, upstreamURL: source.url, provenance, secrets: ['split-secret'] })
    cleanup.push(() => recorder.close())
    await consume(recorder.url).catch(() => undefined)
    await expect(recorder.finish()).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe(original)
  })

  it.each(['tool_use', 'thinking'])('rejects unsupported %s streams without overwriting', async (type) => {
    await record()
    const original = await readFile(path, 'utf8')
    const source = await upstream((response) =>
      response.end(
        [
          chunks[0],
          event({ type: 'content_block_start', index: 0, content_block: { type } }),
          event({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{"secret":"split-' },
          }),
          event({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: 'secret"}' },
          }),
          ...chunks.slice(3),
        ].join('')
      )
    )
    const recorder = await startRecorder({ path, upstreamURL: source.url, provenance, secrets: ['split-secret'] })
    cleanup.push(() => recorder.close())
    await consume(recorder.url).catch(() => undefined)
    await expect(recorder.finish()).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe(original)
  })

  it('rejects provider redirects without contacting the redirect target', async () => {
    let redirectedRequests = 0
    const target = await upstream((response) => {
      redirectedRequests++
      response.end(chunks.join(''))
    })
    const source = await upstream((response) => response.end(), 302, { location: target.url })
    const recorder = await startRecorder({ path, upstreamURL: source.url, provenance })
    cleanup.push(() => recorder.close())
    await expect(consume(recorder.url)).rejects.toThrow()
    await expect(recorder.finish()).rejects.toThrow()
    expect(redirectedRequests).toBe(0)
    await expect(readFile(path)).rejects.toThrow()
  })

  it('close stops accepting connections and never publishes unfinished recording', async () => {
    const source = await upstream()
    const recorder = await startRecorder({ path, upstreamURL: source.url, provenance })
    cleanup.push(() => recorder.close())
    await recorder.close()
    await expect(fetch(recorder.url)).rejects.toThrow()
    await expect(readFile(path)).rejects.toThrow()
  })

  it('close aborts a pending upstream response', async () => {
    const source = await upstream((response) => response.write(chunks[0]))
    const recorder = await startRecorder({ path, upstreamURL: source.url, provenance })
    cleanup.push(() => recorder.close())
    const response = await fetch(`${recorder.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ ...request, stream: true }),
    })
    const body = response.text().catch(() => undefined)
    await recorder.close()
    await body
    await expect(readFile(path)).rejects.toThrow()
  }, 5000)
})
