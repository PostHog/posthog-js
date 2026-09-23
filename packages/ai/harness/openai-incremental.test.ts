import { fork } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { startCollector } from './collector'

it.each([
  { scenario: 'openai-chat-stream', outputTokens: 6 },
  { scenario: 'openai-responses-stream', outputTokens: 7 },
])('delivers $scenario text before the provider completes the stream', async ({ scenario, outputTokens }) => {
  const fixture = JSON.parse(await readFile(new URL(`./fixtures/${scenario}.json`, import.meta.url), 'utf8'))
  const interaction = fixture.interactions[0]
  const chunks: string[] = interaction.response.body.chunks
  const firstDelta = chunks.findIndex((chunk) => {
    const data = chunk
      .split('\n')
      .find((line) => line.startsWith('data:'))
      ?.slice(5)
      .trim()
    if (!data || data === '[DONE]') return false
    const event = JSON.parse(data)
    return Boolean(event.choices?.[0]?.delta?.content || (event.type === 'response.output_text.delta' && event.delta))
  })
  expect(firstDelta).toBeGreaterThanOrEqual(0)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let completed = false
  const requests: string[] = []
  const server = createServer(async (request, response) => {
    requests.push(`${request.method} ${request.url}`)
    request.resume()
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
  const child = fork(fileURLToPath(new URL('./scenarios/openai.mjs', import.meta.url)), [], {
    execArgv: [],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      SCENARIO: scenario,
      PROVIDER_URL: `http://127.0.0.1:${address.port}`,
      COLLECTOR_URL: collector.url,
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
    expect(message).toMatchObject({ type: 'text', text: expect.any(String) })
    expect(message.text.length).toBeGreaterThan(0)
    expect(completed).toBe(false)
    expect(collector.events).toHaveLength(0)
    release()
    const [code] = await exited
    expect(code).toBe(0)
    const events = JSON.parse(output).results[0]
    const text = events
      .map(
        (event: any) =>
          event.choices?.[0]?.delta?.content ?? (event.type === 'response.output_text.delta' ? event.delta : '')
      )
      .join('')
    expect(text).toBe('Hello from the cassette test.')
    expect(requests).toEqual([`POST ${interaction.request.path}`])
    collector.verify()
    expect(collector.events).toHaveLength(1)
    expect(collector.events[0].properties).toMatchObject({ $ai_input_tokens: 17, $ai_output_tokens: outputTokens })
  } finally {
    release()
    if (child.exitCode === null) child.kill()
    await exited
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await collector.close()
  }
})
