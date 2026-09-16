import { fork } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { startCollector } from './collector'

it('delivers text through the built wrapper before the provider completes the stream', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/anthropic-stream.json', import.meta.url), 'utf8'))
  const interaction = fixture.interactions[0]
  const chunks: string[] = interaction.response.body.chunks
  const firstDelta = chunks.findIndex(
    (chunk) => chunk.includes('"type":"text_delta"') || chunk.includes('"type": "text_delta"')
  )
  expect(firstDelta).toBeGreaterThanOrEqual(0)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let requests = 0
  let completed = false
  const server = createServer(async (request, response) => {
    requests++
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
  const child = fork(fileURLToPath(new URL('./scenarios/anthropic-stream.mjs', import.meta.url)), [], {
    execArgv: [],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      PROVIDER_URL: `http://127.0.0.1:${address.port}`,
      COLLECTOR_URL: collector.url,
      REQUEST: JSON.stringify(interaction.request.body),
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
    expect(JSON.parse(output)).toEqual({ text: 'Hello! 👋\n\nHow can I help you today?' })
    expect(requests).toBe(1)
    collector.verify()
    expect(collector.events).toHaveLength(1)
    expect(collector.events[0].properties).toMatchObject({ $ai_input_tokens: 10, $ai_output_tokens: 16 })
  } finally {
    release()
    if (child.exitCode === null) child.kill()
    await exited
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await collector.close()
  }
})
