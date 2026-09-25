import { GoogleGenAI, type GenerateContentParameters, type EmbedContentParameters } from '@google/genai'
import { execFile, fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { startRecorder, startReplay } from './cassette'
import { startCollector } from './collector'

const model = 'gemini-synthetic'
const usage = {
  promptTokenCount: 11,
  candidatesTokenCount: 3,
  totalTokenCount: 19,
  thoughtsTokenCount: 5,
  cachedContentTokenCount: 7,
}
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
type Operation = 'generateContent' | 'generateContentStream' | 'embedContent'

async function runSynthetic(operation: Operation, request: Record<string, unknown>, responseBody: unknown) {
  const directory = await mkdtemp(join(tmpdir(), 'ai-gemini-wrapper-'))
  const path = join(directory, 'synthetic.json')
  const streaming = operation === 'generateContentStream'
  const server = createServer((incoming, response) => {
    incoming.resume()
    response.writeHead(200, { 'content-type': streaming ? 'text/event-stream' : 'application/json' })
    response.end(streaming ? (responseBody as unknown[]).map(frame).join('') : JSON.stringify(responseBody))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing synthetic upstream address')
  const recording = await startRecorder({
    path,
    upstreamURL: `http://127.0.0.1:${address.port}`,
    provenance: { source: 'synthetic', recordedAt: '2026-09-21T00:00:00Z', providerSdkVersion: 'test' },
  })
  const collector = await startCollector()
  let replay: Awaited<ReturnType<typeof startReplay>> | undefined
  try {
    const sdk = new GoogleGenAI({
      apiKey: 'fake-gemini-key',
      httpOptions: { baseUrl: recording.url, apiVersion: 'v1beta', timeout: 2000, retryOptions: { attempts: 1 } },
    })
    const providerRequest = Object.fromEntries(Object.entries(request).filter(([key]) => !key.startsWith('posthog')))
    if (operation === 'generateContentStream') {
      for await (const _chunk of await sdk.models.generateContentStream(
        providerRequest as unknown as GenerateContentParameters
      )) {
        /* consume complete recording */
      }
    } else if (operation === 'embedContent') {
      await sdk.models.embedContent(providerRequest as unknown as EmbedContentParameters)
    } else {
      await sdk.models.generateContent(providerRequest as unknown as GenerateContentParameters)
    }
    await recording.finish()
    await recording.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    replay = await startReplay({ path })
    const result = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('./scenarios/gemini.mjs', import.meta.url))],
      {
        env: {
          PROVIDER_URL: replay.url,
          COLLECTOR_URL: collector.url,
          GEMINI_REQUEST: JSON.stringify(request),
          GEMINI_OPERATION: operation,
        },
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      }
    )
    await replay.finish()
    collector.verify()
    expect(collector.events).toHaveLength(1)
    expect(await readFile(path, 'utf8')).not.toContain('fake-gemini-key')
    expect(result.stdout + result.stderr).not.toContain('fake-gemini-key')
    return { output: JSON.parse(result.stdout), event: collector.events[0] }
  } finally {
    await replay?.close()
    await recording.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await collector.close()
    await rm(directory, { recursive: true, force: true })
  }
}

it.each([
  ['generateContent', false],
  ['generateContent', true],
  ['generateContentStream', false],
  ['generateContentStream', true],
] as const)(
  'built Gemini %s preserves caller output, usage and identity with privacy=%s',
  async (operation, privacy) => {
    const candidate = {
      index: 0,
      content: { role: 'model', parts: [{ text: 'Olá, synthetic caller.' }] },
      finishReason: 'STOP',
    }
    const body =
      operation === 'generateContentStream'
        ? [
            {
              candidates: [
                { ...candidate, content: { role: 'model', parts: [{ text: 'Olá, ' }] }, finishReason: undefined },
              ],
              usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 1, totalTokenCount: 12 },
            },
            {
              candidates: [
                { index: 0, content: { role: 'model', parts: [{ text: 'synthetic caller.' }] }, finishReason: 'STOP' },
              ],
              usageMetadata: usage,
            },
          ]
        : { candidates: [candidate], usageMetadata: usage }
    const { output, event } = await runSynthetic(
      operation,
      {
        model,
        contents: 'Synthetic private input.',
        posthogDistinctId: 'gemini-cassette-user',
        posthogTraceId: 'gemini-cassette-trace',
        posthogProperties: { scenario: 'synthetic-gemini' },
        posthogPrivacyMode: privacy,
      },
      body
    )
    expect(output.text).toBe('Olá, synthetic caller.')
    expect(operation === 'generateContentStream' ? output.chunks.at(-1).usageMetadata : output.usageMetadata).toEqual(
      usage
    )
    expect(event).toMatchObject({
      event: '$ai_generation',
      distinct_id: 'gemini-cassette-user',
      properties: {
        $ai_provider: 'gemini',
        $ai_model: model,
        $ai_trace_id: 'gemini-cassette-trace',
        $ai_input_tokens: 11,
        $ai_output_tokens: 3,
        $ai_reasoning_tokens: 5,
        $ai_cache_read_input_tokens: 7,
        $ai_cache_reporting_exclusive: false,
        $ai_stop_reason: 'STOP',
        $ai_http_status: 200,
        $ai_usage: usage,
        scenario: 'synthetic-gemini',
      },
    })
    expect(event.properties.$ai_input).toEqual(privacy ? null : [{ role: 'user', content: 'Synthetic private input.' }])
    expect(event.properties.$ai_output_choices).toEqual(
      privacy ? null : [{ role: 'assistant', content: [{ type: 'text', text: 'Olá, synthetic caller.' }] }]
    )
    if (privacy) expect(JSON.stringify(event)).not.toContain('Synthetic private input.')
    if (operation === 'generateContentStream') expect(event.properties.$ai_time_to_first_token).toBeTypeOf('number')
  }
)

it.each(['generateContent', 'generateContentStream'] as const)(
  'built Gemini %s preserves function calls and tool telemetry',
  async (operation) => {
    const call = { name: 'weather', args: { city: 'Paris' } }
    const body = {
      candidates: [{ index: 0, content: { role: 'model', parts: [{ functionCall: call }] }, finishReason: 'STOP' }],
      usageMetadata: usage,
    }
    const { output, event } = await runSynthetic(
      operation,
      {
        model,
        contents: 'Weather in Paris?',
        config: {
          automaticFunctionCalling: { disable: true },
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'weather',
                  description: 'Read weather',
                  parameters: { type: 'OBJECT', properties: { city: { type: 'STRING' } }, required: ['city'] },
                },
              ],
            },
          ],
        },
      },
      operation === 'generateContentStream' ? [body] : body
    )
    const candidates = operation === 'generateContentStream' ? output.chunks[0].candidates : output.candidates
    expect(candidates[0].content.parts[0].functionCall).toEqual(call)
    expect(event.properties.$ai_tools).toEqual([
      {
        functionDeclarations: [
          {
            name: 'weather',
            description: 'Read weather',
            parameters: { type: 'OBJECT', properties: { city: { type: 'STRING' } }, required: ['city'] },
          },
        ],
      },
    ])
    expect(event.properties.$ai_output_choices).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'function', function: { name: 'weather', arguments: { city: 'Paris' } } }],
      },
    ])
    expect(event.properties.$ai_stop_reason).toBe('STOP')
  }
)

it.each([false, true])(
  'built Gemini embeddings preserve vectors but omit them from analytics with privacy=%s',
  async (privacy) => {
    const { output, event } = await runSynthetic(
      'embedContent',
      {
        model,
        contents: 'Synthetic embedding input.',
        posthogDistinctId: 'embedding-user',
        posthogPrivacyMode: privacy,
      },
      { embeddings: [{ values: [0.25, -0.5, 0.75] }] }
    )
    expect(output.embeddings[0].values).toEqual([0.25, -0.5, 0.75])
    expect(event).toMatchObject({
      event: '$ai_embedding',
      distinct_id: 'embedding-user',
      properties: {
        $ai_provider: 'gemini',
        $ai_model: model,
        $ai_input_tokens: 0,
        $ai_http_status: 200,
        $ai_output_choices: null,
      },
    })
    expect(event.properties.$ai_input).toBe(privacy ? null : 'Synthetic embedding input.')
    expect(JSON.stringify(event)).not.toContain('0.25')
  }
)

it.each([
  ['generateContent', 'MAX_TOKENS'],
  ['generateContentStream', 'MAX_TOKENS'],
  ['generateContent', 'SAFETY'],
  ['generateContentStream', 'SAFETY'],
] as const)('built Gemini %s preserves the %s completion contract', async (operation, reason) => {
  const body =
    reason === 'SAFETY'
      ? { promptFeedback: { blockReason: 'SAFETY' }, usageMetadata: { promptTokenCount: 11, totalTokenCount: 11 } }
      : {
          candidates: [
            { index: 0, content: { role: 'model', parts: [{ text: 'Cut short' }] }, finishReason: 'MAX_TOKENS' },
          ],
          usageMetadata: usage,
        }
  const { output, event } = await runSynthetic(
    operation,
    { model, contents: 'Synthetic terminal case.' },
    operation === 'generateContentStream' ? [body] : body
  )
  const result = operation === 'generateContentStream' ? output.chunks[0] : output
  if (reason === 'SAFETY') {
    expect(result.promptFeedback).toEqual({ blockReason: 'SAFETY' })
    expect(event.properties.$ai_stop_reason).toBeUndefined()
    expect(event.properties.$ai_output_choices).toEqual([])
    expect(event.properties.$ai_output_tokens).toBe(0)
  } else {
    expect(output.text).toBe('Cut short')
    expect(result.candidates[0].finishReason).toBe('MAX_TOKENS')
    expect(event.properties.$ai_stop_reason).toBe('MAX_TOKENS')
    expect(event.properties.$ai_output_tokens).toBe(3)
  }
  expect(event.properties.$ai_is_error).toBeUndefined()
})

it('delivers a Gemini chunk through the built wrapper before the upstream finishes', async () => {
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let completed = false
  let requests = 0
  const server = createServer(async (incoming, response) => {
    requests++
    incoming.resume()
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(frame({ candidates: [{ index: 0, content: { role: 'model', parts: [{ text: 'First token' }] } }] }))
    await gate
    completed = true
    response.end(frame({ candidates: [{ index: 0, finishReason: 'STOP' }], usageMetadata: usage }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing synthetic provider address')
  const collector = await startCollector()
  const child = fork(fileURLToPath(new URL('./scenarios/gemini.mjs', import.meta.url)), [], {
    execArgv: [],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      PROVIDER_URL: `http://127.0.0.1:${address.port}`,
      COLLECTOR_URL: collector.url,
      GEMINI_OPERATION: 'generateContentStream',
      GEMINI_REQUEST: JSON.stringify({ model, contents: 'Synthetic incremental case.' }),
    },
  })
  const exited = once(child, 'close')
  let output = ''
  child.stdout!.on('data', (chunk) => {
    output += chunk
  })
  child.stderr!.resume()
  try {
    const [message] = await once(child, 'message', { signal: AbortSignal.timeout(3000) })
    expect(message).toEqual({ type: 'text', text: 'First token' })
    expect(completed).toBe(false)
    expect(collector.events).toHaveLength(0)
    release()
    const [code] = await exited
    expect(code).toBe(0)
    expect(JSON.parse(output).text).toBe('First token')
    expect(requests).toBe(1)
    collector.verify()
    expect(collector.events).toHaveLength(1)
    expect(collector.events[0].properties).toMatchObject({
      $ai_input_tokens: 11,
      $ai_output_tokens: 3,
      $ai_stop_reason: 'STOP',
    })
  } finally {
    release()
    if (child.exitCode === null) child.kill()
    await exited
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await collector.close()
  }
})
