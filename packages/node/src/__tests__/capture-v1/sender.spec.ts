import type { PostHogEventProperties, PostHogFetchResponse } from '@posthog/core'

import { CaptureV1Error } from '@/capture-v1/errors'
import { V1CaptureSender, type V1CaptureSenderConfig, type V1CaptureSenderHooks } from '@/capture-v1/sender'

const CLOCK_START = Date.parse('2024-01-01T00:00:00.000Z')

function makeResponse(status: number, body?: unknown, headers?: Record<string, string>): PostHogFetchResponse {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? {})
  return {
    status,
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body),
    headers: { get: (name: string) => headers?.[name] ?? null },
    body: null,
  }
}

function msg(uuid: string, overrides: PostHogEventProperties = {}): PostHogEventProperties {
  return { event: 'test', distinct_id: 'user', uuid, properties: {}, ...overrides }
}

interface Harness {
  sender: V1CaptureSender
  fetch: jest.Mock<Promise<PostHogFetchResponse>, [string, any]>
  sleeps: number[]
  errors: Error[]
  clock: { value: number }
}

function makeSender(
  configOverrides: Partial<V1CaptureSenderConfig> = {},
  hookOverrides: Partial<V1CaptureSenderHooks> = {}
): Harness {
  const sleeps: number[] = []
  const errors: Error[] = []
  const clock = { value: CLOCK_START }
  const fetch = jest.fn<Promise<PostHogFetchResponse>, [string, any]>()

  const sender = new V1CaptureSender(
    {
      host: 'https://t.posthog.com',
      apiKey: 'phc_test',
      libraryId: 'posthog-node',
      libraryVersion: '1.2.3',
      userAgent: 'posthog-node/1.2.3',
      historicalMigration: false,
      compressionEnabled: false,
      requestTimeoutMs: 1000,
      maxAttempts: 4,
      initialRetryDelayMs: 100,
      maxBackoffMs: 30_000,
      ...configOverrides,
    },
    {
      fetch,
      onError: (error) => errors.push(error),
      now: () => clock.value,
      // Advancing the clock while "sleeping" models wall-clock passing between attempts.
      sleep: (ms) => {
        sleeps.push(ms)
        clock.value += ms
        return Promise.resolve()
      },
      generateRequestId: () => 'req-fixed',
      ...hookOverrides,
    }
  )

  return { sender, fetch, sleeps, errors, clock }
}

function bodyOf(fetch: Harness['fetch'], call: number): any {
  return JSON.parse(fetch.mock.calls[call][1].body)
}

function headersOf(fetch: Harness['fetch'], call: number): Record<string, string> {
  return fetch.mock.calls[call][1].headers
}

describe('V1CaptureSender', () => {
  describe('request contract', () => {
    it('POSTs to the v1 analytics endpoint with the batch envelope and no v0 fields', async () => {
      const { sender, fetch, errors } = makeSender()
      fetch.mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.sendV1Batch([msg('u1')])

      expect(fetch).toHaveBeenCalledTimes(1)
      const [url, options] = fetch.mock.calls[0]
      expect(url).toBe('https://t.posthog.com/i/v1/analytics/events')
      expect(options.method).toBe('POST')

      const body = bodyOf(fetch, 0)
      expect(body.created_at).toBe('2024-01-01T00:00:00.000Z')
      expect(body.batch).toHaveLength(1)
      expect(body.batch[0].uuid).toBe('u1')
      expect(body).not.toHaveProperty('api_key')
      expect(body).not.toHaveProperty('sent_at')
      expect(body).not.toHaveProperty('historical_migration')
      expect(errors).toEqual([])
    })

    it('sets all required v1 headers with Bearer auth and no api_key in the body', async () => {
      const { sender, fetch } = makeSender()
      fetch.mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.sendV1Batch([msg('u1')])

      const headers = headersOf(fetch, 0)
      expect(headers['Content-Type']).toBe('application/json')
      expect(headers['Authorization']).toBe('Bearer phc_test')
      expect(headers['PostHog-Sdk-Info']).toBe('posthog-node/1.2.3')
      expect(headers['PostHog-Attempt']).toBe('1')
      expect(headers['PostHog-Request-Id']).toBe('req-fixed')
      expect(headers['PostHog-Request-Timestamp']).toBe('2024-01-01T00:00:00.000Z')
      expect(headers['User-Agent']).toBe('posthog-node/1.2.3')
    })

    it('omits User-Agent when not configured', async () => {
      const { sender, fetch } = makeSender({ userAgent: undefined })
      fetch.mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.sendV1Batch([msg('u1')])

      expect(headersOf(fetch, 0)).not.toHaveProperty('User-Agent')
    })

    it('includes historical_migration only when enabled', async () => {
      const { sender, fetch } = makeSender({ historicalMigration: true })
      fetch.mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.sendV1Batch([msg('u1')])

      expect(bodyOf(fetch, 0).historical_migration).toBe(true)
    })

    it('keeps request-id and created_at stable but increments attempt and regenerates request-timestamp', async () => {
      const { sender, fetch } = makeSender()
      fetch
        .mockResolvedValueOnce(makeResponse(200, { results: { u1: { result: 'retry' } } }))
        .mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.sendV1Batch([msg('u1')])

      const h0 = headersOf(fetch, 0)
      const h1 = headersOf(fetch, 1)
      expect(h0['PostHog-Request-Id']).toBe(h1['PostHog-Request-Id'])
      expect(bodyOf(fetch, 0).created_at).toBe(bodyOf(fetch, 1).created_at)
      expect(h0['PostHog-Attempt']).toBe('1')
      expect(h1['PostHog-Attempt']).toBe('2')
      expect(h0['PostHog-Request-Timestamp']).not.toBe(h1['PostHog-Request-Timestamp'])
    })

    it('does not send when there are no messages', async () => {
      const { sender, fetch, errors } = makeSender()
      await sender.sendV1Batch([])
      expect(fetch).not.toHaveBeenCalled()
      expect(errors).toEqual([])
    })
  })

  describe('compression', () => {
    it('gzips the body and advertises Content-Encoding when compression succeeds', async () => {
      const blob = new Blob(['compressed'])
      const compress = jest.fn().mockResolvedValue(blob)
      const { sender, fetch } = makeSender({ compressionEnabled: true }, { compress })
      fetch.mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.sendV1Batch([msg('u1')])

      expect(compress).toHaveBeenCalledTimes(1)
      expect(headersOf(fetch, 0)['Content-Encoding']).toBe('gzip')
      expect(fetch.mock.calls[0][1].body).toBe(blob)
    })

    it('falls back to uncompressed when compression returns null', async () => {
      const compress = jest.fn().mockResolvedValue(null)
      const { sender, fetch } = makeSender({ compressionEnabled: true }, { compress })
      fetch.mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.sendV1Batch([msg('u1')])

      expect(headersOf(fetch, 0)).not.toHaveProperty('Content-Encoding')
      expect(typeof fetch.mock.calls[0][1].body).toBe('string')
    })

    it('does not compress when disabled', async () => {
      const compress = jest.fn()
      const { sender, fetch } = makeSender({ compressionEnabled: false }, { compress })
      fetch.mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.sendV1Batch([msg('u1')])

      expect(compress).not.toHaveBeenCalled()
      expect(headersOf(fetch, 0)).not.toHaveProperty('Content-Encoding')
    })
  })

  describe('2xx per-event classification', () => {
    it.each([
      ['ok', { result: 'ok' }],
      ['warning', { result: 'warning' }],
      ['unknown code', { result: 'something_new' }],
    ])('treats %s as terminal success with no retry or error', async (_label, result) => {
      const { sender, fetch, errors } = makeSender()
      fetch.mockResolvedValueOnce(makeResponse(200, { results: { u1: result } }))

      await sender.sendV1Batch([msg('u1')])

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(errors).toEqual([])
    })

    it('treats an absent uuid as accepted', async () => {
      const { sender, fetch, errors } = makeSender()
      fetch.mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.sendV1Batch([msg('u1')])

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(errors).toEqual([])
    })

    it('treats a valid 2xx body without a results field as all accepted', async () => {
      const { sender, fetch, errors } = makeSender()
      fetch.mockResolvedValueOnce(makeResponse(200, { status: 1 }))

      await sender.sendV1Batch([msg('u1')])

      expect(errors).toEqual([])
    })

    it('surfaces a drop as a terminal failure without retrying', async () => {
      const { sender, fetch, errors } = makeSender()
      fetch.mockResolvedValueOnce(makeResponse(200, { results: { u1: { result: 'drop', details: 'billing' } } }))

      await sender.sendV1Batch([msg('u1')])

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(errors).toHaveLength(1)
      const error = errors[0] as CaptureV1Error
      expect(error).toBeInstanceOf(CaptureV1Error)
      expect(error.drops).toEqual([{ uuid: 'u1', details: 'billing' }])
      expect(error.retryExhausted).toEqual([])
    })

    it('surfaces a drop with no details', async () => {
      const { sender, fetch, errors } = makeSender()
      fetch.mockResolvedValueOnce(makeResponse(200, { results: { u1: { result: 'drop' } } }))

      await sender.sendV1Batch([msg('u1')])

      expect((errors[0] as CaptureV1Error).drops).toEqual([{ uuid: 'u1', details: undefined }])
    })

    it('resends only the retry-tagged events on the next attempt', async () => {
      const { sender, fetch, errors } = makeSender()
      fetch
        .mockResolvedValueOnce(makeResponse(200, { results: { u1: { result: 'ok' }, u2: { result: 'retry' } } }))
        .mockResolvedValueOnce(makeResponse(200, { results: { u2: { result: 'ok' } } }))

      await sender.sendV1Batch([msg('u1'), msg('u2')])

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(bodyOf(fetch, 0).batch.map((e: any) => e.uuid)).toEqual(['u1', 'u2'])
      expect(bodyOf(fetch, 1).batch.map((e: any) => e.uuid)).toEqual(['u2'])
      expect(errors).toEqual([])
    })

    it('does not swallow drops accumulated on an earlier attempt when a later attempt succeeds', async () => {
      const { sender, fetch, errors } = makeSender()
      fetch
        .mockResolvedValueOnce(
          makeResponse(200, { results: { u1: { result: 'drop', details: 'bad' }, u2: { result: 'retry' } } })
        )
        .mockResolvedValueOnce(makeResponse(200, { results: { u2: { result: 'ok' } } }))

      await sender.sendV1Batch([msg('u1'), msg('u2')])

      expect(errors).toHaveLength(1)
      const error = errors[0] as CaptureV1Error
      expect(error.drops).toEqual([{ uuid: 'u1', details: 'bad' }])
      expect(error.retryExhausted).toEqual([])
    })

    it('reports retry-exhausted uuids after the attempt budget runs out', async () => {
      const { sender, fetch, errors } = makeSender({ maxAttempts: 3 })
      fetch.mockResolvedValue(makeResponse(200, { results: { u1: { result: 'retry' } } }))

      await sender.sendV1Batch([msg('u1')])

      expect(fetch).toHaveBeenCalledTimes(3)
      const error = errors[0] as CaptureV1Error
      expect(error.retryExhausted).toEqual(['u1'])
      expect(error.drops).toEqual([])
    })
  })

  describe('2xx malformed body', () => {
    it('treats an unparseable 2xx body as terminal failure without retrying', async () => {
      const { sender, fetch, errors } = makeSender()
      fetch.mockResolvedValueOnce(makeResponse(200, 'not-json{'))

      await sender.sendV1Batch([msg('u1')])

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(errors).toHaveLength(1)
      const error = errors[0] as CaptureV1Error
      expect(error.retryExhausted).toEqual(['u1'])
      expect((error.cause as Error).message).toContain('unparseable')
    })

    it.each([
      ['a non-object JSON body', '[1,2,3]'],
      ['a non-object results field', { results: [1, 2] }],
    ])('treats %s as terminal failure', async (_label, body) => {
      const { sender, fetch, errors } = makeSender()
      fetch.mockResolvedValueOnce(makeResponse(200, body))

      await sender.sendV1Batch([msg('u1')])

      expect(fetch).toHaveBeenCalledTimes(1)
      expect((errors[0] as CaptureV1Error).retryExhausted).toEqual(['u1'])
    })
  })

  describe('HTTP status classification', () => {
    it.each([408, 500, 502, 503, 504])('retries retryable status %s then succeeds', async (status) => {
      const { sender, fetch, errors } = makeSender()
      fetch.mockResolvedValueOnce(makeResponse(status)).mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.sendV1Batch([msg('u1')])

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(errors).toEqual([])
    })

    it('treats 429 as terminal in v1 (no retry)', async () => {
      const { sender, fetch, errors } = makeSender()
      fetch.mockResolvedValueOnce(makeResponse(429, '', { 'Retry-After': '1' }))

      await sender.sendV1Batch([msg('u1')])

      expect(fetch).toHaveBeenCalledTimes(1)
      const error = errors[0] as CaptureV1Error
      expect(error.retryExhausted).toEqual(['u1'])
      expect((error.cause as Error).message).toContain('429')
    })

    it.each([400, 401, 402, 413, 415])('treats non-retryable status %s as terminal', async (status) => {
      const { sender, fetch, errors } = makeSender()
      fetch.mockResolvedValueOnce(makeResponse(status))

      await sender.sendV1Batch([msg('u1')])

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(errors).toHaveLength(1)
      expect((errors[0] as CaptureV1Error).retryExhausted).toEqual(['u1'])
    })

    it('exhausts the budget on a persistently retryable status', async () => {
      const { sender, fetch, errors } = makeSender({ maxAttempts: 4 })
      fetch.mockResolvedValue(makeResponse(503))

      await sender.sendV1Batch([msg('u1')])

      expect(fetch).toHaveBeenCalledTimes(4)
      expect((errors[0] as CaptureV1Error).retryExhausted).toEqual(['u1'])
    })
  })

  describe('transport errors', () => {
    it('retries a transport error then succeeds', async () => {
      const { sender, fetch, errors } = makeSender()
      fetch.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.sendV1Batch([msg('u1')])

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(errors).toEqual([])
    })

    it('surfaces a batch failure after transport errors exhaust the budget', async () => {
      const { sender, fetch, errors } = makeSender({ maxAttempts: 3 })
      fetch.mockRejectedValue(new Error('timeout'))

      await sender.sendV1Batch([msg('u1'), msg('u2')])

      expect(fetch).toHaveBeenCalledTimes(3)
      const error = errors[0] as CaptureV1Error
      expect(error.retryExhausted).toEqual(['u1', 'u2'])
      expect((error.cause as Error).message).toBe('timeout')
    })
  })

  describe('backoff and Retry-After', () => {
    it('uses exponential backoff between attempts', async () => {
      const { sender, fetch, sleeps } = makeSender({ initialRetryDelayMs: 100, maxAttempts: 4 })
      fetch.mockResolvedValue(makeResponse(503))

      await sender.sendV1Batch([msg('u1')])

      expect(sleeps).toEqual([100, 200, 400])
    })

    it('caps exponential backoff at maxBackoffMs', async () => {
      const { sender, fetch, sleeps } = makeSender({
        initialRetryDelayMs: 10_000,
        maxBackoffMs: 15_000,
        maxAttempts: 4,
      })
      fetch.mockResolvedValue(makeResponse(503))

      await sender.sendV1Batch([msg('u1')])

      expect(sleeps).toEqual([10_000, 15_000, 15_000])
    })

    it('treats Retry-After delta-seconds as a minimum (raises a small backoff)', async () => {
      const { sender, fetch, sleeps } = makeSender({ initialRetryDelayMs: 100, maxAttempts: 2 })
      fetch
        .mockResolvedValueOnce(makeResponse(503, '', { 'Retry-After': '5' }))
        .mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.sendV1Batch([msg('u1')])

      expect(sleeps).toEqual([5000])
    })

    it('does not let a small Retry-After shorten a larger backoff', async () => {
      const { sender, fetch, sleeps } = makeSender({ initialRetryDelayMs: 10_000, maxAttempts: 2 })
      fetch
        .mockResolvedValueOnce(makeResponse(503, '', { 'Retry-After': '1' }))
        .mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.sendV1Batch([msg('u1')])

      expect(sleeps).toEqual([10_000])
    })

    it('clamps a huge Retry-After to maxBackoffMs', async () => {
      const { sender, fetch, sleeps } = makeSender({ initialRetryDelayMs: 100, maxBackoffMs: 30_000, maxAttempts: 2 })
      fetch
        .mockResolvedValueOnce(makeResponse(503, '', { 'Retry-After': '9999' }))
        .mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.sendV1Batch([msg('u1')])

      expect(sleeps).toEqual([30_000])
    })

    it('parses an HTTP-date Retry-After as a delay from now', async () => {
      const { sender, fetch, sleeps } = makeSender({ initialRetryDelayMs: 100, maxBackoffMs: 60_000, maxAttempts: 2 })
      // 20s after the fixed clock start.
      fetch
        .mockResolvedValueOnce(makeResponse(503, '', { 'Retry-After': 'Mon, 01 Jan 2024 00:00:20 GMT' }))
        .mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.sendV1Batch([msg('u1')])

      expect(sleeps).toEqual([20_000])
    })

    it('ignores a past HTTP-date Retry-After and uses backoff', async () => {
      const { sender, fetch, sleeps } = makeSender({ initialRetryDelayMs: 100, maxAttempts: 2 })
      fetch
        .mockResolvedValueOnce(makeResponse(503, '', { 'Retry-After': 'Mon, 01 Jan 2020 00:00:00 GMT' }))
        .mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.sendV1Batch([msg('u1')])

      expect(sleeps).toEqual([100])
    })

    it.each(['0', '-5', 'garbage'])('ignores a non-positive/invalid Retry-After (%s)', async (retryAfter) => {
      const { sender, fetch, sleeps } = makeSender({ initialRetryDelayMs: 100, maxAttempts: 2 })
      fetch
        .mockResolvedValueOnce(makeResponse(503, '', { 'Retry-After': retryAfter }))
        .mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.sendV1Batch([msg('u1')])

      expect(sleeps).toEqual([100])
    })
  })

  describe('default hooks (no injection)', () => {
    const baseConfig: V1CaptureSenderConfig = {
      host: 'https://t.posthog.com',
      apiKey: 'phc_test',
      libraryId: 'posthog-node',
      libraryVersion: '1.2.3',
      historicalMigration: false,
      compressionEnabled: false,
      requestTimeoutMs: 1000,
      maxAttempts: 2,
      initialRetryDelayMs: 1,
      maxBackoffMs: 30_000,
    }

    it('uses the real clock, request-id generator and sleep when not injected', async () => {
      const errors: Error[] = []
      const fetch = jest
        .fn<Promise<PostHogFetchResponse>, [string, any]>()
        .mockResolvedValueOnce(makeResponse(503))
        .mockResolvedValueOnce(makeResponse(200, { results: {} }))

      const sender = new V1CaptureSender(baseConfig, { fetch, onError: (e) => errors.push(e) })
      // No injected sleep: the retry backoff schedules a real (fake-timer) setTimeout we must advance.
      const done = sender.sendV1Batch([msg('u1')])
      await jest.advanceTimersByTimeAsync(baseConfig.initialRetryDelayMs)
      await done

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(errors).toEqual([])
      const headers = fetch.mock.calls[0][1].headers
      expect(headers['PostHog-Request-Id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      expect(headers['PostHog-Request-Timestamp']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    })

    it('uses the real gzip compressor when not injected', async () => {
      const fetch = jest
        .fn<Promise<PostHogFetchResponse>, [string, any]>()
        .mockResolvedValueOnce(makeResponse(200, { results: {} }))

      const sender = new V1CaptureSender({ ...baseConfig, compressionEnabled: true }, { fetch, onError: () => {} })
      await sender.sendV1Batch([msg('u1')])

      expect(fetch.mock.calls[0][1].headers['Content-Encoding']).toBe('gzip')
      expect(fetch.mock.calls[0][1].body).toBeInstanceOf(Blob)
    })
  })
})
