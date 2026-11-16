import { GoogleGenAI } from '@google/genai'
import { createServer, type ServerResponse } from 'node:http'
import type { PostHog } from 'posthog-node'
import { expect, it, vi } from 'vitest'
import { PostHogGoogleGenAI } from '@posthog/ai/gemini'
import { geminiClientOptions } from './gemini-scenarios.mjs'

const created = { event_type: 'interaction.created', interaction: { id: 'local_stalled', status: 'in_progress' } }
const frame = (event: { event_type: string }) => `event: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`

async function withStalledProvider(
  run: (client: PostHogGoogleGenAI, capture: ReturnType<typeof vi.fn>, closed: Promise<void>) => Promise<void>
) {
  let response: ServerResponse | undefined
  let notifyClosed!: () => void
  const closed = new Promise<void>((resolve) => {
    notifyClosed = resolve
  })
  const server = createServer((request, outgoing) => {
    expect(request.url).toBe('/v1beta/interactions')
    request.resume()
    response = outgoing
    outgoing.on('close', notifyClosed)
    outgoing.writeHead(200, { 'content-type': 'text/event-stream' })
    outgoing.write(frame(created))
    // Deliberately leave the next SDK network read pending until the caller cancels.
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing local provider address')
  const capture = vi.fn()
  const posthog = { capture, captureImmediate: vi.fn(), privacy_mode: false } as unknown as PostHog
  const client = new PostHogGoogleGenAI({
    ...geminiClientOptions(`http://127.0.0.1:${address.port}`, 'local-test-key', 10000),
    posthog,
  })
  try {
    await run(client, capture, closed)
  } finally {
    response?.end()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

async function settlesPromptly<T>(promise: Promise<T>): Promise<T | 'timed out'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<'timed out'>((resolve) => {
        timer = setTimeout(() => resolve('timed out'), 1000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

it('cancels an actual Google SDK pending SSE read and closes its local HTTP connection', async () => {
  await withStalledProvider(async (client, capture, closed) => {
    const stream = await client.interactions.create({ model: 'gemini-synthetic', input: 'Hello', stream: true })
    const reader = stream.getReader()
    expect((await reader.read()).value).toEqual(created)
    const pendingRead = reader.read()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(await settlesPromptly(reader.cancel('caller stopped'))).not.toBe('timed out')
    expect(await pendingRead).toEqual({ done: true, value: undefined })
    expect(await settlesPromptly(closed)).not.toBe('timed out')
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture.mock.calls[0][0].properties).toMatchObject({
      $ai_completion_id: 'local_stalled',
      $ai_stop_reason: 'cancelled',
    })
    expect(capture.mock.calls[0][0].properties.$ai_input_tokens).toBeUndefined()
    reader.releaseLock()
  })
})

it('closes an actual Google SDK stalled transport after an early async-iterator break', async () => {
  await withStalledProvider(async (client, capture, closed) => {
    const stream = await client.interactions.create({ model: 'gemini-synthetic', input: 'Hello', stream: true })
    const consume = async () => {
      for await (const event of stream) {
        expect(event).toEqual(created)
        // Let the wrapper attempt its next read before iterator.return() is invoked.
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        break
      }
    }
    expect(await settlesPromptly(consume())).not.toBe('timed out')
    expect(await settlesPromptly(closed)).not.toBe('timed out')
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture.mock.calls[0][0].properties.$ai_stop_reason).toBe('cancelled')
  })
})

it('keeps a tee branch live until both branches cancel, then closes the SDK transport exactly once', async () => {
  await withStalledProvider(async (client, capture, closed) => {
    const stream = await client.interactions.create({ model: 'gemini-synthetic', input: 'Hello', stream: true })
    const [left, right] = stream.tee()
    const leftReader = left.getReader()
    const rightReader = right.getReader()
    expect((await leftReader.read()).value).toEqual(created)
    expect((await rightReader.read()).value).toEqual(created)
    const pendingRead = rightReader.read()
    const leftCancelled = leftReader.cancel('left stopped')
    expect(capture).not.toHaveBeenCalled()
    const rightCancelled = rightReader.cancel('right stopped')
    expect(await settlesPromptly(Promise.all([leftCancelled, rightCancelled]))).not.toBe('timed out')
    expect(await pendingRead).toEqual({ done: true, value: undefined })
    expect(await settlesPromptly(closed)).not.toBe('timed out')
    expect(capture).toHaveBeenCalledTimes(1)
    leftReader.releaseLock()
    rightReader.releaseLock()
  })
})

it('preserves the actual SDK async-iterator error surface for a broken local connection', async () => {
  const server = createServer((request, response) => {
    request.resume()
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(frame(created))
    setTimeout(() => {
      response.destroy()
    }, 30)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing local provider address')
  const options = geminiClientOptions(`http://127.0.0.1:${address.port}`, 'local-test-key', 1000)
  const capture = vi.fn()
  const native = new GoogleGenAI(options)
  const wrapped = new PostHogGoogleGenAI({
    ...options,
    posthog: { capture, privacy_mode: false } as unknown as PostHog,
  })
  async function getError(client: GoogleGenAI | PostHogGoogleGenAI) {
    const stream = await client.interactions.create(
      { model: 'gemini-synthetic', input: 'Hello', stream: true },
      { maxRetries: 0 }
    )
    try {
      for await (const _event of stream) {
        /* advance to provider failure */
      }
      throw new Error('Expected local transport to fail')
    } catch (error) {
      return error as Error & { status?: number }
    }
  }
  try {
    const nativeError = await getError(native)
    const wrappedError = await getError(wrapped)
    expect(wrappedError.constructor).toBe(nativeError.constructor)
    expect(wrappedError.name).toBe(nativeError.name)
    expect(wrappedError.message).toBe(nativeError.message)
    expect(wrappedError.status).toBe(nativeError.status)
    expect(wrappedError.message).not.toBe('Expected local transport to fail')
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture.mock.calls[0][0].properties.$ai_is_error).toBe(true)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
