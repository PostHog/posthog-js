import Anthropic from '@anthropic-ai/sdk'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startRecorder, startReplay } from './cassette'

const request = {
  model: 'synthetic-model',
  max_tokens: 128,
  messages: [{ role: 'user' as const, content: 'Look up the weather in Paris and London.' }],
  tools: [{ name: 'weather', input_schema: { type: 'object' as const, properties: { city: { type: 'string' } } } }],
}
const provenance = { source: 'synthetic' as const, recordedAt: '2026-09-15T00:00:00Z', providerSdkVersion: 'test' }
const event = (value: Record<string, unknown>) => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`
const start = event({
  type: 'message_start',
  message: {
    id: 'msg_synthetic_tools',
    type: 'message',
    role: 'assistant',
    model: request.model,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 19, output_tokens: 0 },
  },
})
const end = [
  event({
    type: 'message_delta',
    delta: { stop_reason: 'tool_use', stop_sequence: null },
    usage: { output_tokens: 23 },
  }),
  event({ type: 'message_stop' }),
]
const toolStart = (index: number) =>
  event({
    type: 'content_block_start',
    index,
    content_block: { type: 'tool_use', id: `toolu_${index}`, name: 'weather', input: {} },
  })
const delta = (index: number, partial_json: string) =>
  event({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json } })
const stop = (index: number) => event({ type: 'content_block_stop', index })
const text = [
  event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
  event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Checking both cities.' } }),
  stop(0),
]
const tools = [
  toolStart(1),
  delta(1, '{"city":'),
  delta(1, '"Paris"}'),
  stop(1),
  toolStart(2),
  delta(2, '{"city":"Lon'),
  delta(2, 'don"}'),
  stop(2),
]

describe('client tool cassettes', () => {
  let directory: string
  let path: string
  let cleanup: Array<() => Promise<void>>

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ai-tool-cassette-'))
    path = join(directory, 'stream.json')
    cleanup = []
  })

  afterEach(async () => {
    for (const close of cleanup.reverse()) await close()
    await rm(directory, { recursive: true, force: true })
  })

  async function recorderFor(blocks: string[], secrets: string[] = []) {
    const server = createServer((incoming, response) => {
      incoming.resume()
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end([start, ...blocks, ...end].join(''))
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
    const recorder = await startRecorder({ path, upstreamURL: `http://127.0.0.1:${address.port}`, provenance, secrets })
    cleanup.push(() => recorder.close())
    return { recorder, closeUpstream: close }
  }

  function client(url: string) {
    return new Anthropic({ apiKey: 'fake-provider-secret', baseURL: url, maxRetries: 0, timeout: 2000 })
  }

  async function consume(url: string) {
    const stream = await client(url).messages.create({ ...request, stream: true })
    const received = []
    for await (const item of stream) received.push(item)
    return received
  }

  it('round-trips mixed text and two fragmented tool inputs through the real SDK after upstream shutdown', async () => {
    const { recorder, closeUpstream } = await recorderFor([...text, ...tools])
    const recorded = await consume(recorder.url)
    await recorder.finish()
    await closeUpstream()
    const replay = await startReplay({ path })
    cleanup.push(() => replay.close())
    expect(await consume(replay.url)).toEqual(recorded)
    await replay.finish()

    const assembled = await startReplay({ path })
    cleanup.push(() => assembled.close())
    const message = await client(assembled.url).messages.stream(request).finalMessage()
    expect(message.content).toEqual([
      { type: 'text', text: 'Checking both cities.' },
      { type: 'tool_use', id: 'toolu_1', name: 'weather', input: { city: 'Paris' } },
      { type: 'tool_use', id: 'toolu_2', name: 'weather', input: { city: 'London' } },
    ])
    expect(message.stop_reason).toBe('tool_use')
    expect(message.usage).toMatchObject({ input_tokens: 19, output_tokens: 23 })
    await assembled.finish()
    expect(await readFile(path, 'utf8')).not.toContain('fake-provider-secret')
  })

  it('accepts a zero-argument client tool through the recorder and unwrapped SDK', async () => {
    const { recorder } = await recorderFor([toolStart(0), stop(0)])
    await consume(recorder.url)
    await recorder.finish()
    const replay = await startReplay({ path })
    cleanup.push(() => replay.close())
    expect((await client(replay.url).messages.stream(request).finalMessage()).content).toEqual([
      { type: 'tool_use', id: 'toolu_0', name: 'weather', input: {} },
    ])
    await replay.finish()
  })

  it.each([
    ['incomplete JSON', [toolStart(0), delta(0, '{"city":'), stop(0)]],
    ['malformed JSON', [toolStart(0), delta(0, '{"city":Paris}'), stop(0)]],
    ['unterminated escaped string', [toolStart(0), delta(0, '"' + '\\"'.repeat(8000)), stop(0)]],
    ['array input', [toolStart(0), delta(0, '[]'), stop(0)]],
    ['null input', [toolStart(0), delta(0, 'null'), stop(0)]],
    ['string input', [toolStart(0), delta(0, '"Paris"'), stop(0)]],
    ['delta for another index', [toolStart(0), delta(1, '{}'), stop(0)]],
    ['stop for another index', [toolStart(0), delta(0, '{}'), stop(1)]],
    ['missing tool stop', [toolStart(0), delta(0, '{}')]],
    ['delta after tool stop', [toolStart(0), delta(0, '{}'), stop(0), delta(0, '{}')]],
    ['tool JSON on a text block', [text[0], delta(0, '{}'), stop(0)]],
    ['text on a tool block', [toolStart(0), text[1], stop(0)]],
    ['duplicate block index', [toolStart(0), delta(0, '{}'), stop(0), toolStart(0), delta(0, '{}'), stop(0)]],
    ['sparse first index', [toolStart(1), delta(1, '{}'), stop(1)]],
    [
      'sparse preceding text index',
      [text[0].replace('"index":0', '"index":2'), stop(2), toolStart(3), delta(3, '{}'), stop(3)],
    ],
    ['duplicate preceding text index', [...text, ...text, toolStart(1), delta(1, '{}'), stop(1)]],
    ['duplicate tool stop', [toolStart(0), delta(0, '{}'), stop(0), stop(0)]],
    [
      'duplicate tool ID',
      [toolStart(0), delta(0, '{}'), stop(0), toolStart(1).replace('toolu_1', 'toolu_0'), delta(1, '{}'), stop(1)],
    ],
    [
      'nonempty initial tool input',
      [
        event({
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'toolu_0',
            name: 'weather',
            input: { city: 'Paris' },
          },
        }),
        stop(0),
      ],
    ],
  ])('rejects %s without replacing an existing file', async (_name, blocks) => {
    await writeFile(path, 'previous recording')
    const { recorder } = await recorderFor(blocks as string[])
    await consume(recorder.url).catch(() => undefined)
    await expect(recorder.finish()).rejects.toThrow('Cassette interaction 1: stream failure')
    expect(await readFile(path, 'utf8')).toBe('previous recording')
  })

  it.each([
    ['known secret across deltas', ['{"city":"split-', 'secret"}']],
    ['escaped known secret value', ['{"city":"split-', '\\u0073ecret"}']],
    ['escaped known secret key', ['{"split-', '\\u0073ecret":"Paris"}']],
    ['overwritten escaped secret value', ['{"city":"split-', '\\u0073ecret","city":"Paris"}']],
    ['overwritten nested credential key', ['{"x":{"pass', '\\u0077ord":"artificial"},"x":{}}']],
    ['escaped credential key', ['{"pass', '\\u0077ord":"artificial"}']],
    ['credential prefix across deltas', ['{"city":"sk-', 'ant-artificial"}']],
  ])('rejects %s after decoding tool input', async (_name, fragments) => {
    await writeFile(path, 'previous recording')
    const { recorder } = await recorderFor(
      [toolStart(0), ...fragments.map((fragment) => delta(0, fragment)), stop(0)],
      ['split-secret']
    )
    await consume(recorder.url).catch(() => undefined)
    await expect(recorder.finish()).rejects.toThrow('Cassette interaction 1: secret failure')
    expect(await readFile(path, 'utf8')).toBe('previous recording')
  })

  it.each(['thinking', 'server_tool_use', 'web_search_tool_result'])(
    'continues rejecting unsupported %s blocks',
    async (type) => {
      const { recorder } = await recorderFor([
        event({ type: 'content_block_start', index: 0, content_block: { type } }),
        stop(0),
      ])
      await consume(recorder.url).catch(() => undefined)
      await expect(recorder.finish()).rejects.toThrow('Cassette interaction 1: stream failure')
      await expect(readFile(path)).rejects.toThrow()
    }
  )
})
