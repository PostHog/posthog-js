import { GoogleGenAI } from '@google/genai'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startRecorder, startReplay } from './cassette'

const model = 'gemini-synthetic'
const request = { model, contents: 'Say hello.' }
const pathFor = (operation: string) => `/v1beta/models/${model}:${operation}`
const provenance = { source: 'synthetic' as const, recordedAt: '2026-09-21T00:00:00Z', providerSdkVersion: 'test' }
const usage = {
  promptTokenCount: 11,
  candidatesTokenCount: 3,
  totalTokenCount: 19,
  thoughtsTokenCount: 5,
  cachedContentTokenCount: 7,
}
const candidate = (text: string, finishReason?: string) => ({
  index: 0,
  content: { role: 'model', parts: [{ text }] },
  ...(finishReason ? { finishReason } : {}),
})
const completed = { candidates: [candidate('Olá.', 'STOP')], usageMetadata: usage, modelVersion: model }
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
const providerValue = (value: unknown) =>
  JSON.parse(JSON.stringify(value, (key, item) => (key === 'sdkHttpResponse' ? undefined : item)))
const frames = [
  frame({ candidates: [candidate('Olá.')] }),
  frame({ candidates: [candidate('', 'STOP')], usageMetadata: usage }),
]

describe('Gemini provider cassettes', () => {
  let directory: string
  let path: string
  let cleanup: Array<() => Promise<void>>

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ai-gemini-cassette-'))
    path = join(directory, 'gemini.json')
    cleanup = []
  })

  afterEach(async () => {
    for (const close of cleanup.reverse()) await close()
    vi.restoreAllMocks()
    await rm(directory, { recursive: true, force: true })
  })

  async function upstream(respond: (request: IncomingMessage, response: ServerResponse) => void) {
    const server = createServer((incoming, response) => {
      incoming.resume()
      respond(incoming, response)
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

  async function consume(url: string) {
    const result = []
    for await (const chunk of await client(url).models.generateContentStream(request)) {
      result.push({ text: chunk.text, candidates: chunk.candidates, usageMetadata: chunk.usageMetadata })
    }
    return result
  }

  async function recorder(url: string, secrets?: string[]) {
    const recording = await startRecorder({ path, upstreamURL: url, provenance, secrets })
    cleanup.push(() => recording.close())
    return recording
  }

  it('records and replays real SDK JSON, SSE and embeddings after upstream shutdown', async () => {
    const seen: Array<{ url: string | undefined; method: string | undefined; apiKey: string | string[] | undefined }> =
      []
    const source = await upstream((incoming, response) => {
      seen.push({ url: incoming.url, method: incoming.method, apiKey: incoming.headers['x-goog-api-key'] })
      response.setHeader('x-goog-api-key', 'response-gemini-key')
      if (incoming.url?.includes(':streamGenerateContent')) {
        response.writeHead(200, { 'content-type': 'text/event-stream' }).end(frames.join(''))
      } else if (incoming.url?.includes(':batchEmbedContents')) {
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ embeddings: [{ values: [0.25, -0.5, 0.75] }] }))
      } else {
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(completed))
      }
    })
    const recording = await recorder(source.url)
    const json = await client(recording.url).models.generateContent(request)
    const stream = await consume(recording.url)
    const embedding = await client(recording.url).models.embedContent({ model, contents: 'Hello.' })
    expect(json.text).toBe('Olá.')
    expect(json.usageMetadata).toEqual(usage)
    expect(stream.map((chunk) => chunk.text).join('')).toBe('Olá.')
    expect(stream.at(-1)).toMatchObject({ candidates: [{ finishReason: 'STOP' }], usageMetadata: usage })
    expect(embedding.embeddings?.[0].values).toEqual([0.25, -0.5, 0.75])
    expect(seen).toEqual(
      ['generateContent', 'streamGenerateContent?alt=sse', 'batchEmbedContents'].map((operation) => ({
        url: pathFor(operation),
        method: 'POST',
        apiKey: 'fake-gemini-key',
      }))
    )
    await recording.finish()
    await recording.close()
    await source.close()
    const replay = await startReplay({ path })
    cleanup.push(() => replay.close())
    const replayed = await client(replay.url).models.generateContent(request)
    expect(replayed.text).toBe(json.text)
    expect(replayed.usageMetadata).toEqual(json.usageMetadata)
    expect(await consume(replay.url)).toEqual(stream)
    const replayedEmbedding = await client(replay.url).models.embedContent({ model, contents: 'Hello.' })
    expect(providerValue(replayedEmbedding)).toEqual(providerValue(embedding))
    await replay.finish()
    const saved = await readFile(path, 'utf8')
    expect(saved).not.toContain('fake-gemini-key')
    expect(saved).not.toContain('response-gemini-key')
    expect(saved).not.toContain('x-goog-api-key')
    expect(JSON.parse(saved)).toMatchObject({
      provenance,
      interactions: [
        { response: { body: { kind: 'json', value: completed } } },
        { response: { body: { kind: 'sse' } } },
        { response: { body: { kind: 'json' } } },
      ],
    })
  })

  it('forwards the first SDK chunk before EOF, preserving split UTF-8 and a usage-only tail', async () => {
    let release = () => {}
    const source = await upstream((_incoming, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const bytes = Buffer.from(frames[0])
      const split = bytes.indexOf(Buffer.from('á')) + 1
      response.write(bytes.subarray(0, split))
      setImmediate(() => response.write(bytes.subarray(split)))
      release = () => response.end(frame({ candidates: [candidate('', 'STOP')] }) + frame({ usageMetadata: usage }))
    })
    const recording = await recorder(source.url)
    let text = ''
    let finalUsage
    try {
      for await (const chunk of await client(recording.url).models.generateContentStream(request)) {
        if (chunk.text) {
          text += chunk.text
          release()
        }
        if (chunk.usageMetadata) finalUsage = chunk.usageMetadata
      }
    } finally {
      release()
    }
    expect(text).toBe('Olá.')
    expect(finalUsage).toEqual(usage)
    await recording.finish()
  })

  it.each([
    [
      'function call and thought',
      {
        candidates: [
          {
            index: 0,
            content: {
              role: 'model',
              parts: [
                { text: 'Planning.', thought: true },
                { functionCall: { name: 'weather', args: { city: 'Paris' } }, thoughtSignature: 'synthetic-signature' },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: usage,
      },
    ],
    [
      'blocked prompt',
      {
        promptFeedback: { blockReason: 'SAFETY', safetyRatings: [] },
        usageMetadata: { promptTokenCount: 11, totalTokenCount: 11 },
      },
    ],
    [
      'multiple candidates',
      {
        candidates: [candidate('One.', 'STOP'), { ...candidate('Two.', 'MAX_TOKENS'), index: 1 }],
        usageMetadata: usage,
      },
    ],
  ])('preserves %s through the SDK for JSON and SSE', async (_name, value) => {
    const source = await upstream((incoming, response) => {
      const streaming = incoming.url?.includes(':streamGenerateContent')
      response
        .writeHead(200, { 'content-type': streaming ? 'text/event-stream' : 'application/json' })
        .end(streaming ? frame(value) : JSON.stringify(value))
    })
    const recording = await recorder(source.url)
    // SDK text getters warn on non-text parts; this case checks the raw parsed candidate instead.
    const json = await client(recording.url).models.generateContent(request)
    expect(providerValue(json)).toMatchObject(value)
    const streamed = []
    for await (const chunk of await client(recording.url).models.generateContentStream(request))
      streamed.push(providerValue(chunk))
    expect(streamed).toEqual([expect.objectContaining(value)])
    await recording.finish()
    await source.close()
    const replay = await startReplay({ path })
    cleanup.push(() => replay.close())
    expect(providerValue(await client(replay.url).models.generateContent(request))).toMatchObject(value)
    const replayed = []
    for await (const chunk of await client(replay.url).models.generateContentStream(request))
      replayed.push(providerValue(chunk))
    expect(replayed).toEqual(streamed)
    await replay.finish()
  })

  it.each([
    ['malformed JSON', 'application/json', '{'],
    [
      'missing finish',
      'application/json',
      JSON.stringify({ candidates: [candidate('partial')], usageMetadata: usage }),
    ],
    ['malformed SSE', 'text/event-stream', 'data: {\n\n'],
    ['truncated frame', 'text/event-stream', frames.join('').slice(0, -1)],
    ['missing terminal', 'text/event-stream', frames[0]],
    ['content after terminal', 'text/event-stream', frames.join('') + frames[0]],
    [
      'credential in JSON',
      'application/json',
      JSON.stringify({ ...completed, candidates: [candidate('fake-gemini-key', 'STOP')] }),
    ],
    [
      'credential across SSE events',
      'text/event-stream',
      frame({ candidates: [candidate('fake-gemini-')] }) +
        frame({ candidates: [candidate('key', 'STOP')], usageMetadata: usage }),
    ],
    ['credential field', 'application/json', JSON.stringify({ ...completed, 'x-goog-api-key': 'unknown-key' })],
    ...[false, true].map((thought) => [
      `credential hidden by interleaved ${thought ? 'visible' : 'thought'} text`,
      'text/event-stream',
      frame({
        candidates: [
          {
            index: 0,
            content: {
              parts: [
                { text: 'fake-gemini-', thought },
                { text: 'interleaved', thought: !thought },
                { text: 'key', thought },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: usage,
      }),
    ]),
    [
      'overwritten credential value',
      'application/json',
      JSON.stringify(completed).replace(
        '"modelVersion":',
        '"ignored":"fake-gemini-key","ignored":"safe","modelVersion":'
      ),
    ],
    [
      'unfinished second candidate',
      'text/event-stream',
      frame({ candidates: [candidate('One.', 'STOP'), { ...candidate('Two.'), index: 1 }], usageMetadata: usage }),
    ],
  ])('atomically rejects %s and emits only safe errors', async (_name, contentType, body) => {
    const original = 'existing recording must survive'
    await writeFile(path, original)
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    let contacted = 0
    const source = await upstream((_incoming, response) => {
      contacted++
      response.writeHead(200, { 'content-type': contentType }).end(body)
    })
    const recording = await recorder(source.url)
    const operation =
      contentType === 'text/event-stream'
        ? consume(recording.url)
        : client(recording.url).models.generateContent(request)
    await operation.catch(() => undefined)
    await expect(recording.finish()).rejects.toThrow(/^Cassette interaction 1: \w+ failure$/)
    expect(contacted).toBe(1)
    expect(await readFile(path, 'utf8')).toBe(original)
    expect(await readdir(directory)).toEqual(['gemini.json'])
    expect(JSON.stringify([...warnings.mock.calls, ...errors.mock.calls])).not.toContain('fake-gemini-key')
  })

  it.each([
    `${pathFor('generateContent')}?key=query-secret`,
    `${pathFor('streamGenerateContent')}?alt=sse&key=query-secret`,
    `${pathFor('streamGenerateContent')}?alt=json`,
    `${pathFor('generateContent')}?arbitrary=value`,
    '/v1beta/models/nested/model:generateContent',
    '/v1beta/models/gemini-synthetic:delete',
  ])('rejects unsupported route %s before contacting upstream', async (route) => {
    let contacted = 0
    const source = await upstream((_incoming, response) => {
      contacted++
      response.end('{}')
    })
    const recording = await recorder(source.url)
    const response = await fetch(`${recording.url}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'hello' }] }] }),
    })
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('Cassette request failed')
    await expect(recording.finish()).rejects.toThrow('request failure')
    expect(contacted).toBe(0)
    await expect(readFile(path)).rejects.toThrow()
  })

  it('rejects redirects without forwarding the API key to a second origin', async () => {
    let redirected = 0
    const target = await upstream((_incoming, response) => {
      redirected++
      response.end('{}')
    })
    const source = await upstream((_incoming, response) => response.writeHead(302, { location: target.url }).end())
    const recording = await recorder(source.url)
    await expect(client(recording.url).models.generateContent(request)).rejects.toThrow()
    await expect(recording.finish()).rejects.toThrow()
    expect(redirected).toBe(0)
    await expect(readFile(path)).rejects.toThrow()
  })

  it('retains request mismatches, extra requests and unconsumed interactions', async () => {
    const source = await upstream((_incoming, response) =>
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(completed))
    )
    const recording = await recorder(source.url)
    await client(recording.url).models.generateContent(request)
    await recording.finish()
    await source.close()
    for (const mode of ['model', 'body', 'extra', 'unconsumed']) {
      const replay = await startReplay({ path })
      cleanup.push(() => replay.close())
      if (mode === 'model' || mode === 'body') {
        await expect(
          client(replay.url).models.generateContent({
            ...request,
            ...(mode === 'model' ? { model: 'different-model' } : { contents: 'Different prompt.' }),
          })
        ).rejects.toThrow()
      } else if (mode === 'extra') {
        await client(replay.url).models.generateContent(request)
        await expect(client(replay.url).models.generateContent(request)).rejects.toThrow()
      }
      await expect(replay.finish()).rejects.toThrow()
      await replay.close()
    }
  })

  it('normalizes CR-only SSE framing into replayable SDK chunks', async () => {
    const source = await upstream((_incoming, response) =>
      response.writeHead(200, { 'content-type': 'text/event-stream' }).end(frames.join('').replace(/\n/g, '\r'))
    )
    const recording = await recorder(source.url)
    // Raw HTTP consumption isolates SSE framing support from the SDK's own line parser.
    const result = await fetch(`${recording.url}${pathFor('streamGenerateContent?alt=sse')}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Say hello.' }] }] }),
    })
    expect((await result.text()).includes('\r')).toBe(true)
    await recording.finish()
    const replay = await startReplay({ path })
    cleanup.push(() => replay.close())
    expect((await consume(replay.url)).map((chunk) => chunk.text).join('')).toBe('Olá.')
    await replay.finish()
  })

  it('validates stored response semantics before starting replay', async () => {
    const source = await upstream((_incoming, response) =>
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(completed))
    )
    const recording = await recorder(source.url)
    await client(recording.url).models.generateContent(request)
    await recording.finish()
    const saved = JSON.parse(await readFile(path, 'utf8'))
    delete saved.interactions[0].response.body.value.candidates[0].finishReason
    await writeFile(path, JSON.stringify(saved))
    await expect(startReplay({ path })).rejects.toThrow()
  })

  it('supports Gemini provenance only with the pinned live origin without making a request', async () => {
    const recording = await startRecorder({
      path,
      upstreamURL: 'https://generativelanguage.googleapis.com',
      provenance: { ...provenance, source: 'gemini' },
    })
    await recording.close()
    await expect(readFile(path)).rejects.toThrow()
  })

  it.each([
    'http://generativelanguage.googleapis.com',
    'https://example.com',
    'https://generativelanguage.googleapis.com/path',
    'https://generativelanguage.googleapis.com?key=secret',
    'http://127.0.0.1:1234',
  ])('rejects live Gemini upstream %s', async (upstreamURL) => {
    await expect(
      startRecorder({ path, upstreamURL, provenance: { ...provenance, source: 'gemini' } })
    ).rejects.toThrow()
  })
})
