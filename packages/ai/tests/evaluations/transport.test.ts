import { createServer } from 'node:http'
import { once } from 'node:events'
import { OfflineEvaluations, EvaluationAPIError } from '../../src/evaluations'
import { Transport } from '../../src/evaluations/transport'
import { client, ID, TIME, experimentResponse, mockFetch, reply } from './helpers'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
it.each([
  ['https://us.i.posthog.com', 'https://us.posthog.com'],
  ['https://eu.i.posthog.com', 'https://eu.posthog.com'],
  ['https://app.posthog.com', 'https://us.posthog.com'],
  ['https://custom.test/prefix/', 'https://custom.test/prefix'],
  ['http://localhost:8000/prefix', 'http://localhost:8000/prefix'],
])('An ingestion host maps to the management host: %s', async (host, expected) => {
  const fetch = mockFetch().mockResolvedValue(reply(experimentResponse()))
  await client({ host }).createExperiment({ name: 'Run', id: ID })
  expect(String(fetch.mock.calls[0][0])).toBe(`${expected}/api/projects/123/ai_observability/offline_experiments/`)
  expect(fetch.mock.calls[0][1]).toMatchObject({
    redirect: 'manual',
    headers: { Authorization: 'Bearer test-secret' },
  })
})
it.each([
  { projectId: 0 },
  { projectId: 1.5 },
  { secretKey: '' },
  { secretKey: 'a b' },
  { timeoutMs: 0 },
  { timeoutMs: Infinity },
  { maxRetries: -1 },
  { maxRetries: 1.5 },
  { host: 'ftp://host' },
  { host: 'https://user:pass@host' },
  { host: 'https://host/?token=secret' },
  { host: 'https://host/#x' },
])('Invalid client options do not send requests: %#', (options) => {
  const fetch = mockFetch()
  expect(() => client(options)).toThrow()
  expect(fetch).not.toHaveBeenCalled()
})
it('Success is an acknowledgment', async () => {
  let respond!: (value: Response) => void
  mockFetch().mockImplementation(
    () =>
      new Promise((resolve) => {
        respond = resolve
      })
  )
  let acknowledged = false
  const pending = client()
    .createExperiment({ name: 'Run', id: ID })
    .then(() => {
      acknowledged = true
    })
  await Promise.resolve()
  expect(acknowledged).toBe(false)
  respond(reply(experimentResponse()))
  await pending
  expect(acknowledged).toBe(true)
})
it.each(['uploading', 'completed', 'failed'])('rejects an array containing receipt status %s', async (status) => {
  const fetch = mockFetch().mockResolvedValue(reply(experimentResponse({ status: [status] })))
  await expect(client({ maxRetries: 3 }).createExperiment({ name: 'Run', id: ID })).rejects.toMatchObject({
    code: 'invalid_response',
    persistence: 'unknown',
  })
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('Creation can be replayed after an uncertain response', async () => {
  const fetch = mockFetch()
    .mockRejectedValueOnce(new Error('lost response'))
    .mockImplementation((_url, init) => Promise.resolve(reply(experimentResponse(JSON.parse(init.body)))))
  const evaluations = client()
  const error = await evaluations.createExperiment({ name: 'Run' }).catch((e) => e)
  expect(error).toMatchObject({ persistence: 'unknown' })
  await evaluations.createExperiment(error.submission)
  expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body)
})
it('Retry preserves the exact upload', async () => {
  vi.useFakeTimers()
  const fetch = mockFetch().mockRejectedValueOnce(new Error('lost')).mockResolvedValue(reply(experimentResponse()))
  const pending = client({ maxRetries: 1 }).createExperiment({ name: 'Run', id: ID })
  await vi.runAllTimersAsync()
  await pending
  expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body)
})
it.each([408, 429, 500, 502, 503, 504])('retries safe operations on %s', async (status) => {
  vi.useFakeTimers()
  const fetch = mockFetch().mockImplementation(() => Promise.resolve(reply({ code: 'retry' }, status)))
  const result = client({ maxRetries: 2 })
    .createExperiment({ name: 'Run' })
    .catch((e) => e)
  await vi.runAllTimersAsync()
  expect(await result).toBeInstanceOf(EvaluationAPIError)
  expect(fetch).toHaveBeenCalledTimes(3)
})
it('A rejection after a lost response cannot erase uncertainty', async () => {
  vi.useFakeTimers()
  mockFetch()
    .mockRejectedValueOnce(new Error('lost'))
    .mockResolvedValue(reply({ code: 'conflict', detail: 'private', attr: 'value', errors: [{ x: 'private' }] }, 409))
  const pending = client({ maxRetries: 1 })
    .createExperiment({ name: 'Run' })
    .catch((e) => e)
  await vi.runAllTimersAsync()
  const error = await pending
  expect(error).toMatchObject({
    persistence: 'unknown',
    status: 409,
    code: 'conflict',
    detail: 'private',
    attr: 'value',
    errors: [{ x: 'private' }],
  })
  expect(String(error)).not.toContain('private')
  expect(JSON.stringify(error)).not.toContain('private')
})
it('Error messages do not expose evaluation content', async () => {
  mockFetch().mockResolvedValue(
    reply({ code: 'invalid', detail: 'private prompt test-secret', errors: ['private'] }, 400)
  )
  const error = await client()
    .createExperiment({ name: 'Run' })
    .catch((e) => e)
  expect(error.persistence).toBe('rejected')
  expect(error.response.detail).toContain('private')
  expect(String(error)).not.toMatch(/private|test-secret/)
})
it.each(['60', new Date(Date.now() + 120000).toUTCString()])(
  'A long Retry-After is not shortened: %s',
  async (header) => {
    const fetch = mockFetch().mockResolvedValue(reply({}, 429, { 'Retry-After': header }))
    const error = await client({ maxRetries: 3 })
      .createExperiment({ name: 'Run' })
      .catch((e) => e)
    expect(error.retryAfter).toBeGreaterThan(30)
    expect(fetch).toHaveBeenCalledTimes(1)
  }
)
it('honors Retry-After and cancellation during backoff', async () => {
  vi.useFakeTimers()
  const fetch = mockFetch().mockResolvedValue(reply({}, 429, { 'Retry-After': '2' }))
  const abort = new AbortController()
  const pending = client({ maxRetries: 2 })
    .createExperiment({ name: 'Run' }, { signal: abort.signal })
    .catch((e) => e)
  await vi.advanceTimersByTimeAsync(1999)
  expect(fetch).toHaveBeenCalledTimes(1)
  abort.abort()
  expect((await pending).name).toBe('AbortError')
  await vi.runAllTimersAsync()
  expect(fetch).toHaveBeenCalledTimes(1)
})
it.each([{}, [], null, 'not an object'])('malformed success remains uncertain without retry %#', async (data) => {
  const fetch = mockFetch().mockImplementation(() => Promise.resolve(reply(data)))
  expect(
    await client({ maxRetries: 3 })
      .createExperiment({ name: 'Run' })
      .catch((e) => e)
  ).toMatchObject({ code: 'invalid_response', persistence: 'unknown' })
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('Context exit does not finish an experiment', async () => {
  const fetch = mockFetch()
  const evaluations = client()
  evaluations.resumeExperiment(ID)
  evaluations.close()
  const handle = evaluations.resumeExperiment(ID)
  await expect(handle.complete()).rejects.toMatchObject({ code: 'client_closed', persistence: 'not_sent' })
  expect(fetch).not.toHaveBeenCalled()
})
it('Cancellation propagates without cleanup writes', async () => {
  const fetch = mockFetch().mockImplementation(
    (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))
  )
  const abort = new AbortController()
  const pending = client({ maxRetries: 3 })
    .createExperiment({ name: 'Run' }, { signal: abort.signal })
    .catch((e) => e)
  abort.abort()
  expect((await pending).name).toBe('AbortError')
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('keeps the timeout active while reading the response body', async () => {
  vi.useFakeTimers()
  const fetch = mockFetch().mockImplementation((_url, init) =>
    Promise.resolve({
      ok: true,
      text: () => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))),
    })
  )
  const pending = client({ timeoutMs: 10 })
    .createExperiment({ name: 'Run' })
    .catch((e) => e)
  await vi.advanceTimersByTimeAsync(11)
  expect(await pending).toMatchObject({ code: 'transport_error', persistence: 'unknown' })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})
it('encodes and decodes full signed-64-bit counts without rounding', async () => {
  const fetch = mockFetch().mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify(experimentResponse()).replace(
          '"expected_item_count":null',
          '"expected_item_count":9223372036854775807'
        )
      )
    )
  )
  const handle = await client().createExperiment({ name: 'Run', id: ID, expectedItemCount: 9223372036854775807n })
  expect(fetch.mock.calls[0][1].body).toContain('"expected_item_count":9223372036854775807')
  expect(handle.receipt?.expectedItemCount).toBe(9223372036854775807n)
  expect(handle.submission?.expectedItemCount).toBe(9223372036854775807n)
})
it('Redirects cannot forward the secret', async () => {
  let redirected = false
  const server = createServer((req, res) => {
    if (req.url === '/target') {
      redirected = true
      res.end('{}')
    } else {
      res.writeHead(302, { Location: '/target' })
      res.end()
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as { port: number }
  try {
    const evaluations = new OfflineEvaluations({
      projectId: 123,
      secretKey: 'secret',
      host: `http://127.0.0.1:${address.port}`,
      maxRetries: 0,
    })
    await expect(evaluations.createExperiment({ name: 'Run', id: ID, startedAt: TIME })).rejects.toMatchObject({
      status: 302,
    })
    expect(redirected).toBe(false)
    evaluations.close()
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
it('rejects internal paths that could change request scope', async () => {
  const fetch = mockFetch()
  const transport = new Transport({ projectId: 123, secretKey: 'secret' })
  for (const path of ['//evil.test', '/path?x=1', '/path#x', 'https://evil.test'])
    await expect(transport.request('GET', path)).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
})
