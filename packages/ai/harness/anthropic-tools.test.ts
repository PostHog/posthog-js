import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages'
import { execFile, fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { startReplay } from './cassette'
import { startCollector } from './collector'

const request = {
  model: 'synthetic-model',
  max_tokens: 128,
  stream: true,
  messages: [{ role: 'user', content: 'Look up the weather in Paris and London.' }],
  tools: [{ name: 'weather', input_schema: { type: 'object', properties: { city: { type: 'string' } } } }],
}
const events = [
  {
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
  },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Checking both cities.' } },
  { type: 'content_block_stop', index: 0 },
  {
    type: 'content_block_start',
    index: 1,
    content_block: { type: 'tool_use', id: 'toolu_1', name: 'weather', input: {} },
  },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"city":' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"Paris"}' } },
  { type: 'content_block_stop', index: 1 },
  {
    type: 'content_block_start',
    index: 2,
    content_block: { type: 'tool_use', id: 'toolu_2', name: 'weather', input: {} },
  },
  { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"city":"Lon' } },
  { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: 'don"}' } },
  { type: 'content_block_stop', index: 2 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 23 } },
  { type: 'message_stop' },
]
const chunks = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
const scenario = fileURLToPath(new URL('./scenarios/anthropic-tools.mjs', import.meta.url))

it('captures the recorded Anthropic tool call through the built SDKs', async () => {
  const path = fileURLToPath(new URL('./fixtures/anthropic-tools.json', import.meta.url))
  const cassette = JSON.parse(await readFile(path, 'utf8'))
  expect(cassette.provenance).toMatchObject({ source: 'anthropic', providerSdkVersion: '0.124.0' })
  const replay = await startReplay({ path })
  const collector = await startCollector()
  try {
    const result = await promisify(execFile)(process.execPath, [scenario], {
      env: {
        PROVIDER_URL: replay.url,
        COLLECTOR_URL: collector.url,
        REQUEST: JSON.stringify(cassette.interactions[0].request.body),
      },
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    })
    const received: RawMessageStreamEvent[] = JSON.parse(result.stdout).events
    // Transport fidelity is separate from the independently checked analytics below.
    const recorded = cassette.interactions[0].response.body.chunks.map((chunk: string) =>
      JSON.parse(
        chunk
          .split('\n')
          .find((line) => line.startsWith('data:'))!
          .slice(5)
      )
    )
    expect(received).toEqual(recorded.filter((event: { type: string }) => event.type !== 'ping'))
    const deltas = received.filter(
      (event) => event.type === 'content_block_delta' && event.delta.type === 'input_json_delta'
    )
    expect(deltas.length).toBeGreaterThan(1)
    const input = deltas
      .map((event) =>
        event.type === 'content_block_delta' && event.delta.type === 'input_json_delta' ? event.delta.partial_json : ''
      )
      .join('')
    expect(JSON.parse(input)).toEqual({ city: 'Paris', unit: 'celsius' })
    await replay.finish()
    collector.verify()
    expect(collector.events).toHaveLength(1)
    // Checked against the live message_start/message_delta, not the wrapper output.
    expect(collector.events[0]).toMatchObject({
      event: '$ai_generation',
      distinct_id: 'cassette-test',
      properties: {
        $ai_provider: 'anthropic',
        $ai_model: 'claude-haiku-4-5-20251001',
        $ai_input_tokens: 681,
        $ai_output_tokens: 50,
        $ai_stop_reason: 'tool_use',
        $ai_usage: {
          input_tokens: 681,
          output_tokens: 50,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
        },
      },
    })
    expect(collector.events[0].properties.$ai_cache_read_input_tokens).toBeUndefined()
    expect(collector.events[0].properties.$ai_cache_creation_input_tokens).toBeUndefined()
    expect(collector.events[0].properties.$ai_tools).toEqual([
      {
        name: 'get_weather',
        description: 'Get the weather for a city.',
        input_schema: {
          type: 'object',
          properties: { city: { type: 'string' }, unit: { type: 'string', enum: ['celsius'] } },
          required: ['city', 'unit'],
        },
      },
    ])
    expect(collector.events[0].properties.$ai_output_choices).toEqual([
      {
        role: 'assistant',
        content: [
          {
            type: 'function',
            id: 'toolu_01H6WJYqCeDywnhGEcSwCcUu',
            function: { name: 'get_weather', arguments: { city: 'Paris', unit: 'celsius' } },
          },
        ],
      },
    ])
  } finally {
    await replay.close()
    await collector.close()
  }
})

function verifyCaller(stdout: string) {
  const received: RawMessageStreamEvent[] = JSON.parse(stdout).events
  expect(received).toEqual(events)
  const inputs = new Map<number, string>()
  for (const event of received) {
    if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
      inputs.set(event.index, (inputs.get(event.index) ?? '') + event.delta.partial_json)
    }
  }
  expect([...inputs].map(([index, json]) => ({ index, input: JSON.parse(json) }))).toEqual([
    { index: 1, input: { city: 'Paris' } },
    { index: 2, input: { city: 'London' } },
  ])
}

function verifyAnalytics(collector: Awaited<ReturnType<typeof startCollector>>) {
  collector.verify()
  expect(collector.events).toHaveLength(1)
  expect(collector.events[0]).toMatchObject({
    event: '$ai_generation',
    distinct_id: 'cassette-test',
    properties: {
      $ai_provider: 'anthropic',
      $ai_model: 'synthetic-model',
      $ai_input_tokens: 19,
      $ai_output_tokens: 23,
      $ai_stop_reason: 'tool_use',
      $ai_usage: { input_tokens: 19, output_tokens: 23 },
    },
  })
  expect(collector.events[0].properties.$ai_tools).toEqual(request.tools)
  expect(collector.events[0].properties.$ai_output_choices).toEqual([
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Checking both cities.' },
        { type: 'function', id: 'toolu_1', function: { name: 'weather', arguments: { city: 'Paris' } } },
        { type: 'function', id: 'toolu_2', function: { name: 'weather', arguments: { city: 'London' } } },
      ],
    },
  ])
}

it('captures mixed text and two fragmented tool inputs through built SDKs from a synthetic cassette', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-wrapper-tools-'))
  const path = join(directory, 'synthetic-tools.json')
  await writeFile(
    path,
    JSON.stringify({
      formatVersion: 1,
      provenance: { source: 'synthetic', recordedAt: '2026-09-19T00:00:00Z', providerSdkVersion: 'test' },
      interactions: [
        {
          request: {
            method: 'POST',
            path: '/v1/messages',
            headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
            body: request,
          },
          response: { status: 200, headers: { 'content-type': 'text/event-stream' }, body: { kind: 'sse', chunks } },
        },
      ],
    })
  )
  let replay: Awaited<ReturnType<typeof startReplay>> | undefined
  let collector: Awaited<ReturnType<typeof startCollector>> | undefined
  try {
    replay = await startReplay({ path })
    collector = await startCollector()
    const result = await promisify(execFile)(process.execPath, [scenario], {
      env: { PROVIDER_URL: replay.url, COLLECTOR_URL: collector.url, REQUEST: JSON.stringify(request) },
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    })
    verifyCaller(result.stdout)
    await replay.finish()
    verifyAnalytics(collector)
  } finally {
    await replay?.close()
    await collector?.close()
    await rm(directory, { recursive: true, force: true })
  }
})

it('delivers a tool argument fragment through the built wrapper before stream completion', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const firstDelta = 5
  let requests = 0
  let completed = false
  const server = createServer(async (incoming, response) => {
    requests++
    incoming.resume()
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(chunks.slice(0, firstDelta + 1).join(''))
    await gate
    completed = true
    response.end(chunks.slice(firstDelta + 1).join(''))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing provider address')
  const collector = await startCollector()
  const child = fork(scenario, [], {
    execArgv: [],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      PROVIDER_URL: `http://127.0.0.1:${address.port}`,
      COLLECTOR_URL: collector.url,
      REQUEST: JSON.stringify(request),
    },
  })
  const exited = once(child, 'close')
  const deadline = setTimeout(() => child.kill('SIGKILL'), 10000)
  let output = ''
  child.stdout!.on('data', (chunk) => {
    output += chunk
  })
  child.stderr!.resume()
  try {
    const [message] = await once(child, 'message', { signal: AbortSignal.timeout(3000) })
    expect(message).toEqual({ type: 'tool-input', partial_json: '{"city":' })
    expect(completed).toBe(false)
    expect(collector.events).toHaveLength(0)
    release()
    const [code] = await exited
    expect(code).toBe(0)
    verifyCaller(output)
    expect(requests).toBe(1)
    verifyAnalytics(collector)
  } finally {
    release()
    if (child.exitCode === null) child.kill('SIGKILL')
    await exited
    clearTimeout(deadline)
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await collector.close()
  }
})
