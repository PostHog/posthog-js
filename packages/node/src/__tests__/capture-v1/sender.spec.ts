import { type PostHogEventProperties, type PostHogFetchResponse, isGzipSupported } from '@posthog/core'

import { CaptureError } from '@/capture-v1/errors'
import { V1CaptureSender, type V1CaptureSenderConfig, type V1CaptureSenderHooks } from '@/capture-v1/sender'
import { type SerializedV1Event, serializeV1Event } from '@/capture-v1/serialize'

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

function makeStallingResponse(status: number, cancel: vi.Mock<Promise<void>, []>): PostHogFetchResponse {
  const stalledBody = () => new Promise<string>(() => {})

  return {
    status,
    text: stalledBody,
    json: stalledBody,
    headers: { get: () => null },
    body: { cancel } as unknown as ReadableStream<Uint8Array>,
  }
}

function msg(uuid: string, overrides: PostHogEventProperties = {}): PostHogEventProperties {
  return { event: 'test', distinct_id: 'user', uuid, properties: {}, ...overrides }
}

const v1Events = (messages: PostHogEventProperties[]): SerializedV1Event[] => messages.map(serializeV1Event)

interface Harness {
  sender: V1CaptureSender
  fetch: vi.Mock<Promise<PostHogFetchResponse>, [string, any]>
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
  const fetch = vi.fn<[string, any], Promise<PostHogFetchResponse>>()

  const sender = new V1CaptureSender(
    {
      host: 'https://t.posthog.com',
      path: '/i/v1/analytics/events',
      apiKey: 'phc_test',
      libraryId: 'posthog-node',
      libraryVersion: '1.2.3',
      userAgent: 'posthog-node/1.2.3',
      historicalMigration: false,
      compressionEnabled: false,
      requestTimeoutMs: 1000,
      maxRetries: 3,
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
      // The midpoint of the jitter range, so waits are exactly 100 ms, 200 ms, 400 ms, ...
      random: () => 0.5,
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
    it.each(['/i/v1/analytics/events', '/i/v1/ai/events'] as const)(
      'POSTs to its %s lane with the batch envelope and no v0 fields',
      async (path) => {
        const { sender, fetch, errors } = makeSender({ path })
        fetch.mockResolvedValueOnce(makeResponse(200, { results: {} }))

        await sender.send(v1Events([msg('u1')]))

        expect(fetch).toHaveBeenCalledTimes(1)
        const [url, options] = fetch.mock.calls[0]
        expect(url).toBe(`https://t.posthog.com${path}`)
        expect(options.method).toBe('POST')

        const body = bodyOf(fetch, 0)
        expect(body.created_at).toBe('2024-01-01T00:00:00.000Z')
        expect(body.batch).toHaveLength(1)
        expect(body.batch[0].uuid).toBe('u1')
        expect(body).not.toHaveProperty('api_key')
        expect(body).not.toHaveProperty('sent_at')
        expect(body).not.toHaveProperty('historical_migration')
        expect(errors).toEqual([])
      }
    )

    it('sets all required v1 headers with Bearer auth and no api_key in the body', async () => {
      const { sender, fetch } = makeSender()
      fetch.mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.send(v1Events([msg('u1')]))

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

      await sender.send(v1Events([msg('u1')]))

      expect(headersOf(fetch, 0)).not.toHaveProperty('User-Agent')
    })

    it('includes historical_migration only when enabled', async () => {
      const { sender, fetch } = makeSender({ historicalMigration: true })
      fetch.mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.send(v1Events([msg('u1')]))

      expect(bodyOf(fetch, 0).historical_migration).toBe(true)
    })

    it('keeps request-id and created_at stable but increments attempt and regenerates request-timestamp', async () => {
      let nextRequestId = 0
      const generateRequestId = vi.fn(() => `req-${++nextRequestId}`)
      const { sender, fetch } = makeSender({}, { generateRequestId })
      fetch
        .mockResolvedValueOnce(makeResponse(200, { results: { u1: { result: 'retry' } } }))
        .mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.send(v1Events([msg('u1')]))

      const h0 = headersOf(fetch, 0)
      const h1 = headersOf(fetch, 1)
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(h0['PostHog-Request-Id']).toBe('req-1')
      expect(h1['PostHog-Request-Id']).toBe('req-1')
      expect(generateRequestId).toHaveBeenCalledTimes(1)
      expect(bodyOf(fetch, 0).created_at).toBe(bodyOf(fetch, 1).created_at)
      expect(h0['PostHog-Attempt']).toBe('1')
      expect(h1['PostHog-Attempt']).toBe('2')
      expect(h0['PostHog-Request-Timestamp']).not.toBe(h1['PostHog-Request-Timestamp'])
    })

    it('does not send when there are no messages', async () => {
      const { sender, fetch, errors } = makeSender()
      await sender.send(v1Events([]))
      expect(fetch).not.toHaveBeenCalled()
      expect(errors).toEqual([])
    })

    it('still makes one attempt when maxRetries is misconfigured below 0', async () => {
      const { sender, fetch, errors } = makeSender({ maxRetries: -1 })
      fetch.mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.send(v1Events([msg('u1')]))

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(errors).toEqual([])
    })

    it('surfaces a delivery error rather than silently dropping when maxRetries is below 0', async () => {
      const { sender, fetch, errors } = makeSender({ maxRetries: -1 })
      fetch.mockResolvedValueOnce(makeResponse(400))

      await sender.send(v1Events([msg('u1')]))

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toBeInstanceOf(CaptureError)
      expect((errors[0] as CaptureError).retryExhausted).toEqual(['u1'])
    })
  })

  describe('compression', () => {
    it('gzips the body and advertises Content-Encoding when compression succeeds', async () => {
      const blob = new Blob(['compressed'])
      const compress = vi.fn().mockResolvedValue(blob)
      const { sender, fetch } = makeSender({ compressionEnabled: true }, { compress })
      fetch.mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.send(v1Events([msg('u1')]))

      expect(compress).toHaveBeenCalledTimes(1)
      expect(headersOf(fetch, 0)['Content-Encoding']).toBe('gzip')
      expect(fetch.mock.calls[0][1].body).toBe(blob)
    })

    it('falls back to uncompressed when compression returns null', async () => {
      const compress = vi.fn().mockResolvedValue(null)
      const { sender, fetch } = makeSender({ compressionEnabled: true }, { compress })
      fetch.mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.send(v1Events([msg('u1')]))

      expect(headersOf(fetch, 0)).not.toHaveProperty('Content-Encoding')
      expect(typeof fetch.mock.calls[0][1].body).toBe('string')
    })

    it('does not compress when disabled', async () => {
      const compress = vi.fn()
      const { sender, fetch } = makeSender({ compressionEnabled: false }, { compress })
      fetch.mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.send(v1Events([msg('u1')]))

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

      await sender.send(v1Events([msg('u1')]))

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(errors).toEqual([])
    })

    it('treats an absent uuid as accepted', async () => {
      const { sender, fetch, errors } = makeSender()
      fetch.mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.send(v1Events([msg('u1')]))

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(errors).toEqual([])
    })

    it('treats a valid 2xx body without a results field as all accepted', async () => {
      const { sender, fetch, errors } = makeSender()
      fetch.mockResolvedValueOnce(makeResponse(200, { status: 1 }))

      await sender.send(v1Events([msg('u1')]))

      expect(errors).toEqual([])
    })

    it.each(['/i/v1/analytics/events', '/i/v1/ai/events'] as const)(
      'surfaces a drop on the %s lane as a terminal CaptureError naming that lane',
      async (path) => {
        const { sender, fetch, errors } = makeSender({ path })
        fetch.mockResolvedValueOnce(makeResponse(200, { results: { u1: { result: 'drop', details: 'billing' } } }))

        await sender.send(v1Events([msg('u1', { properties: { $ai_input: 'private prompt text' } })]))

        expect(fetch).toHaveBeenCalledTimes(1)
        expect(errors).toHaveLength(1)
        const error = errors[0] as CaptureError
        expect(error).toBeInstanceOf(CaptureError)
        expect(error.name).toBe('CaptureError')
        expect(error.endpoint).toBe(path)
        expect(error.drops).toEqual([{ uuid: 'u1', details: 'billing' }])
        expect(error.retryExhausted).toEqual([])
        expect(error.message).toBe(`Capture batch req-fixed to ${path} did not fully deliver: 1 dropped, 0 undelivered`)
      }
    )

    it('surfaces a drop with no details', async () => {
      const { sender, fetch, errors } = makeSender()
      fetch.mockResolvedValueOnce(makeResponse(200, { results: { u1: { result: 'drop' } } }))

      await sender.send(v1Events([msg('u1')]))

      expect((errors[0] as CaptureError).drops).toEqual([{ uuid: 'u1', details: undefined }])
    })

    it('resends only the retry-tagged events on the next attempt', async () => {
      const { sender, fetch, errors } = makeSender()
      fetch
        .mockResolvedValueOnce(makeResponse(200, { results: { u1: { result: 'ok' }, u2: { result: 'retry' } } }))
        .mockResolvedValueOnce(makeResponse(200, { results: { u2: { result: 'ok' } } }))

      await sender.send(v1Events([msg('u1'), msg('u2')]))

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

      await sender.send(v1Events([msg('u1'), msg('u2')]))

      expect(errors).toHaveLength(1)
      const error = errors[0] as CaptureError
      expect(error.drops).toEqual([{ uuid: 'u1', details: 'bad' }])
      expect(error.retryExhausted).toEqual([])
    })

    it('reports retry-exhausted uuids after the attempt budget runs out', async () => {
      const { sender, fetch, errors } = makeSender({ maxRetries: 2 })
      fetch.mockResolvedValue(makeResponse(200, { results: { u1: { result: 'retry' } } }))

      await sender.send(v1Events([msg('u1')]))

      expect(fetch).toHaveBeenCalledTimes(3)
      const error = errors[0] as CaptureError
      expect(error.retryExhausted).toEqual(['u1'])
      expect(error.drops).toEqual([])
    })
  })

  describe('2xx malformed body', () => {
    it('treats an unparseable 2xx body as terminal failure without retrying', async () => {
      const { sender, fetch, errors } = makeSender()
      fetch.mockResolvedValueOnce(makeResponse(200, 'not-json{'))

      await sender.send(v1Events([msg('u1')]))

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(errors).toHaveLength(1)
      const error = errors[0] as CaptureError
      expect(error.retryExhausted).toEqual(['u1'])
      expect((error.cause as Error).message).toContain('unparseable')
    })

    it.each([
      ['a non-object JSON body', '[1,2,3]'],
      ['a non-object results field', { results: [1, 2] }],
    ])('treats %s as terminal failure', async (_label, body) => {
      const { sender, fetch, errors } = makeSender()
      fetch.mockResolvedValueOnce(makeResponse(200, body))

      await sender.send(v1Events([msg('u1')]))

      expect(fetch).toHaveBeenCalledTimes(1)
      expect((errors[0] as CaptureError).retryExhausted).toEqual(['u1'])
    })
  })

  describe('HTTP status classification', () => {
    it.each([408, 500, 502, 503, 504])('retries retryable status %s then succeeds', async (status) => {
      const { sender, fetch, errors } = makeSender()
      fetch.mockResolvedValueOnce(makeResponse(status)).mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.send(v1Events([msg('u1')]))

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(errors).toEqual([])
    })

    it('treats 429 as terminal in v1 (no retry)', async () => {
      const { sender, fetch, errors } = makeSender()
      fetch.mockResolvedValueOnce(makeResponse(429, '', { 'Retry-After': '1' }))

      await sender.send(v1Events([msg('u1')]))

      expect(fetch).toHaveBeenCalledTimes(1)
      const error = errors[0] as CaptureError
      expect(error.retryExhausted).toEqual(['u1'])
      expect((error.cause as Error).message).toContain('429')
    })

    it.each([400, 401, 402, 404, 413, 415, 501])('treats non-retryable status %s as terminal', async (status) => {
      const { sender, fetch, errors } = makeSender()
      fetch.mockResolvedValueOnce(makeResponse(status))

      await sender.send(v1Events([msg('u1')]))

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(errors).toHaveLength(1)
      expect((errors[0] as CaptureError).retryExhausted).toEqual(['u1'])
    })

    it('exhausts the budget on a persistently retryable status', async () => {
      const { sender, fetch, errors } = makeSender({ maxRetries: 3 })
      fetch.mockResolvedValue(makeResponse(503))

      await sender.send(v1Events([msg('u1')]))

      expect(fetch).toHaveBeenCalledTimes(4)
      expect((errors[0] as CaptureError).retryExhausted).toEqual(['u1'])
    })

    it('bounds response body cancellation by the request deadline before retrying a 5xx', async () => {
      const { sender, fetch, errors, sleeps } = makeSender({ maxRetries: 1 })
      const cancel = vi.fn<[], Promise<void>>(() => new Promise<void>(() => {}))
      fetch
        .mockResolvedValueOnce(makeStallingResponse(503, cancel))
        .mockResolvedValueOnce(makeResponse(503, 'still unavailable'))

      const sendPromise = sender.send(v1Events([msg('u1')]))
      await vi.advanceTimersByTimeAsync(999)
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(sleeps).toEqual([])

      await vi.advanceTimersByTimeAsync(1)
      await sendPromise

      expect(cancel).toHaveBeenCalledTimes(1)
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(sleeps).toEqual([100])
      expect(errors).toHaveLength(1)
      expect(errors[0]).toBeInstanceOf(CaptureError)
      expect((errors[0] as CaptureError).retryExhausted).toEqual(['u1'])
      expect(((errors[0] as CaptureError).cause as Error).message).toContain('HTTP 503: still unavailable')
      expect(vi.getTimerCount()).toBe(0)
    })
  })

  describe('transport errors', () => {
    it('retries a transport error then succeeds', async () => {
      const { sender, fetch, errors } = makeSender()
      fetch.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.send(v1Events([msg('u1')]))

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(errors).toEqual([])
    })

    it('surfaces a batch failure after transport errors exhaust the budget', async () => {
      const { sender, fetch, errors } = makeSender({ maxRetries: 2 })
      fetch.mockRejectedValue(new Error('timeout'))

      await sender.send(v1Events([msg('u1'), msg('u2')]))

      expect(fetch).toHaveBeenCalledTimes(3)
      const error = errors[0] as CaptureError
      expect(error.retryExhausted).toEqual(['u1', 'u2'])
      expect((error.cause as Error).message).toBe('timeout')
    })

    it('identifies a timeout before response headers arrive when custom fetch rejects on abort', async () => {
      const { sender, fetch, errors } = makeSender({ maxRetries: 0, requestTimeoutMs: 1000 })
      fetch.mockImplementation(
        (_url, options) =>
          new Promise<PostHogFetchResponse>((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('custom fetch abort')), {
              once: true,
            })
          })
      )

      const sendPromise = sender.send(v1Events([msg('u1')]))
      await vi.advanceTimersByTimeAsync(1000)
      await sendPromise

      expect(errors).toHaveLength(1)
      const error = errors[0] as CaptureError
      expect((error.cause as Error).name).toBe('AbortError')
      expect((error.cause as Error).message).toBe(
        'Capture V1 request timed out waiting for response headers after 1000ms'
      )
      expect(vi.getTimerCount()).toBe(0)
    })

    it('cancels a response body when custom fetch resolves after the header deadline', async () => {
      const { sender, fetch, errors } = makeSender({ maxRetries: 0, requestTimeoutMs: 1000 })
      let resolveFetch!: (response: PostHogFetchResponse) => void
      fetch.mockImplementation(
        () =>
          new Promise<PostHogFetchResponse>((resolve) => {
            resolveFetch = resolve
          })
      )

      const sendPromise = sender.send(v1Events([msg('u1')]))
      await vi.advanceTimersByTimeAsync(1000)
      await sendPromise

      const cancel = vi.fn<[], Promise<void>>().mockResolvedValue(undefined)
      resolveFetch(makeStallingResponse(200, cancel))
      await vi.advanceTimersByTimeAsync(0)

      expect(cancel).toHaveBeenCalledTimes(1)
      expect(errors).toHaveLength(1)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('retries a stalled success body without waiting for body cancellation to settle', async () => {
      const { sender, fetch, errors, sleeps } = makeSender({ maxRetries: 1, requestTimeoutMs: 1000 })
      const cancel = vi.fn<[], Promise<void>>(() => new Promise<void>(() => {}))
      fetch
        .mockImplementationOnce(() => Promise.resolve(makeStallingResponse(200, cancel)))
        .mockResolvedValueOnce(makeResponse(200, { results: {} }))

      const sendPromise = sender.send(v1Events([msg('u1')]))
      await vi.advanceTimersByTimeAsync(1000)
      await sendPromise

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(sleeps).toEqual([100])
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(errors).toEqual([])
      expect(vi.getTimerCount()).toBe(0)
    })

    it('preserves the response-body timeout error when custom body reading rejects on abort', async () => {
      const { sender, fetch, errors } = makeSender({ maxRetries: 0, requestTimeoutMs: 1000 })
      const cancel = vi.fn<[], Promise<void>>().mockResolvedValue(undefined)
      fetch.mockImplementation((_url, options) => {
        const response = makeStallingResponse(200, cancel)
        response.text = () =>
          new Promise<string>((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('custom body abort')), {
              once: true,
            })
          })
        return Promise.resolve(response)
      })

      const sendPromise = sender.send(v1Events([msg('u1')]))
      await vi.advanceTimersByTimeAsync(1000)
      await sendPromise

      expect(errors).toHaveLength(1)
      const error = errors[0] as CaptureError
      expect((error.cause as Error).name).toBe('AbortError')
      expect((error.cause as Error).message).toBe(
        'Capture V1 request timed out while reading the response body after 1000ms'
      )
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('surfaces CaptureError after stalled success bodies exhaust the timeout retry budget', async () => {
      const { sender, fetch, errors } = makeSender({ maxRetries: 1, requestTimeoutMs: 1000 })
      const cancels: vi.Mock<Promise<void>, []>[] = []
      fetch.mockImplementation(() => {
        const cancel = vi.fn<[], Promise<void>>(() => new Promise<void>(() => {}))
        cancels.push(cancel)
        return Promise.resolve(makeStallingResponse(200, cancel))
      })

      const sendPromise = sender.send(v1Events([msg('u1')]))
      await vi.advanceTimersByTimeAsync(1000)
      await vi.advanceTimersByTimeAsync(1000)
      await sendPromise

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(cancels).toHaveLength(2)
      expect(cancels.every((cancel) => cancel.mock.calls.length === 1)).toBe(true)
      expect(errors).toHaveLength(1)
      const error = errors[0] as CaptureError
      expect(error).toBeInstanceOf(CaptureError)
      expect(error.retryExhausted).toEqual(['u1'])
      expect((error.cause as Error).name).toBe('AbortError')
      expect((error.cause as Error).message).toBe(
        'Capture V1 request timed out while reading the response body after 1000ms'
      )
      expect(vi.getTimerCount()).toBe(0)
    })

    it('times out a stalled HTTP error body without changing terminal status classification', async () => {
      const { sender, fetch, errors } = makeSender({ maxRetries: 1, requestTimeoutMs: 1000 })
      const cancel = vi.fn<[], Promise<void>>().mockResolvedValue(undefined)
      fetch.mockResolvedValue(makeStallingResponse(400, cancel))

      const sendPromise = sender.send(v1Events([msg('u1')]))
      await vi.advanceTimersByTimeAsync(1000)
      await sendPromise

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toBeInstanceOf(CaptureError)
      expect((errors[0] as CaptureError).retryExhausted).toEqual(['u1'])
      expect(((errors[0] as CaptureError).cause as Error).message).toContain('HTTP 400')
      expect(vi.getTimerCount()).toBe(0)
    })
  })

  describe('unsent events (keepUnsent)', () => {
    it('returns events whose last attempt got no response, without reporting them', async () => {
      const { sender, fetch, errors } = makeSender({ maxRetries: 1 })
      fetch.mockRejectedValue(new Error('ECONNREFUSED'))
      const events = v1Events([msg('u1'), msg('u2')])

      const unsent = await sender.send(events, { keepUnsent: true })

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(unsent).toEqual(events)
      expect(errors).toEqual([])
    })

    it('reports server drops and returns only the retry events a later transport failure left unsent', async () => {
      const { sender, fetch, errors } = makeSender({ maxRetries: 1 })
      fetch
        .mockResolvedValueOnce(
          makeResponse(200, {
            results: { u1: { result: 'drop', details: 'billing' }, u2: { result: 'retry' } },
          })
        )
        .mockRejectedValueOnce(new Error('ECONNRESET'))
      const events = v1Events([msg('u1'), msg('u2'), msg('u3')])

      const unsent = await sender.send(events, { keepUnsent: true })

      expect(unsent).toEqual([events[1]])
      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatchObject({ drops: [{ uuid: 'u1', details: 'billing' }], retryExhausted: [] })
    })

    it.each<[string, () => PostHogFetchResponse]>([
      ['an exhausted retryable status', () => makeResponse(500)],
      ['a terminal status', () => makeResponse(400)],
      ['an unparseable 2xx', () => makeResponse(200, 'not json')],
    ])('reports and does not return events after %s', async (_name, response) => {
      const { sender, fetch, errors } = makeSender({ maxRetries: 1 })
      fetch.mockImplementation(() => Promise.resolve(response()))

      const unsent = await sender.send(v1Events([msg('u1')]), { keepUnsent: true })

      expect(unsent).toEqual([])
      expect(errors).toHaveLength(1)
      expect((errors[0] as CaptureError).retryExhausted).toEqual(['u1'])
    })

    it('reports and does not return retry events still pending when the budget runs out on a 2xx', async () => {
      const { sender, fetch, errors } = makeSender({ maxRetries: 1 })
      fetch.mockResolvedValue(makeResponse(200, { results: { u1: { result: 'retry' } } }))

      const unsent = await sender.send(v1Events([msg('u1')]), { keepUnsent: true })

      expect(unsent).toEqual([])
      expect((errors[0] as CaptureError).retryExhausted).toEqual(['u1'])
    })
  })

  describe('abort signal', () => {
    it('makes no request once the signal is aborted', async () => {
      const { sender, fetch, errors } = makeSender()
      const controller = new AbortController()
      controller.abort(new Error('shutdown deadline'))
      const events = v1Events([msg('u1')])

      expect(await sender.send(events, { signal: controller.signal, keepUnsent: true })).toEqual(events)
      expect(fetch).not.toHaveBeenCalled()
      expect(errors).toEqual([])
    })

    it('stops waiting for the next attempt when aborted during backoff', async () => {
      const controller = new AbortController()
      const { sender, fetch, errors } = makeSender({ maxRetries: 3 }, { sleep: () => new Promise(() => {}) })
      fetch.mockResolvedValue(makeResponse(503))

      const sendPromise = sender.send(v1Events([msg('u1')]), { signal: controller.signal })
      await vi.advanceTimersByTimeAsync(0)
      controller.abort(new Error('shutdown deadline'))
      await sendPromise

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(errors).toHaveLength(1)
      expect((errors[0] as CaptureError).retryExhausted).toEqual(['u1'])
    })

    it('aborts a request still waiting for response headers', async () => {
      const controller = new AbortController()
      const { sender, fetch } = makeSender({ maxRetries: 3, requestTimeoutMs: 60_000 })
      fetch.mockImplementation(() => new Promise(() => {}))
      const events = v1Events([msg('u1')])

      const sendPromise = sender.send(events, { signal: controller.signal, keepUnsent: true })
      await vi.advanceTimersByTimeAsync(100)
      controller.abort(new Error('shutdown deadline'))

      expect(await sendPromise).toEqual(events)
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('stops reading a stalled HTTP error body and still reports the status', async () => {
      const controller = new AbortController()
      const { sender, fetch, errors } = makeSender({ maxRetries: 0, requestTimeoutMs: 60_000 })
      fetch.mockResolvedValue(makeStallingResponse(503, vi.fn().mockResolvedValue(undefined)))

      const sendPromise = sender.send(v1Events([msg('u1')]), { signal: controller.signal })
      await vi.advanceTimersByTimeAsync(100)
      controller.abort(new Error('shutdown deadline'))
      await sendPromise

      expect(errors).toHaveLength(1)
      expect(((errors[0] as CaptureError).cause as Error).message).toBe('Capture V1 request failed with HTTP 503')
      expect(vi.getTimerCount()).toBe(0)
    })
  })

  describe('backoff and Retry-After', () => {
    it.each<[string, number, number[]]>([
      ['the lowest jitter', 0, [75, 150, 300]],
      ['no jitter', 0.5, [100, 200, 400]],
      ['the highest jitter', 1, [125, 250, 500]],
    ])('waits 100, 200, 400 ms scaled by %s', async (_label, random, expected) => {
      const { sender, fetch, sleeps } = makeSender({}, { random: () => random })
      fetch.mockResolvedValue(makeResponse(503))

      await sender.send(v1Events([msg('u1')]))

      expect(fetch).toHaveBeenCalledTimes(4)
      expect(sleeps).toEqual(expected)
    })

    it('draws a new jitter for each wait', async () => {
      const draws = [0, 1, 0.5]
      const { sender, fetch, sleeps } = makeSender({}, { random: () => draws.shift()! })
      fetch.mockResolvedValue(makeResponse(503))

      await sender.send(v1Events([msg('u1')]))

      expect(sleeps).toEqual([75, 250, 400])
    })

    it('caps every wait at 30 seconds, after jitter', async () => {
      const { sender, fetch, sleeps } = makeSender({ maxRetries: 9 }, { random: () => 1 })
      fetch.mockResolvedValue(makeResponse(503))

      await sender.send(v1Events([msg('u1')]))

      expect(sleeps).toEqual([125, 250, 500, 1000, 2000, 4000, 8000, 16_000, 30_000])
    })

    it('raises a shorter wait to a Retry-After in delta-seconds', async () => {
      const { sender, fetch, sleeps } = makeSender({ maxRetries: 1 })
      fetch
        .mockResolvedValueOnce(makeResponse(503, '', { 'Retry-After': '5' }))
        .mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.send(v1Events([msg('u1')]))

      expect(sleeps).toEqual([5000])
    })

    it.each<[string, number, number[]]>([
      ['the lowest jitter', 0, [75, 150, 300, 1000]],
      ['the highest jitter', 1, [125, 250, 500, 1000]],
    ])('never lets %s make a wait shorter than Retry-After', async (_label, random, expected) => {
      // The fourth wait has a base of 800 ms, so jitter alone puts it at 600-1000 ms.
      const { sender, fetch, sleeps } = makeSender({ maxRetries: 4 }, { random: () => random })
      fetch
        .mockResolvedValueOnce(makeResponse(503))
        .mockResolvedValueOnce(makeResponse(503))
        .mockResolvedValueOnce(makeResponse(503))
        .mockResolvedValueOnce(makeResponse(503, '', { 'Retry-After': '1' }))
        .mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.send(v1Events([msg('u1')]))

      expect(sleeps).toEqual(expected)
    })

    it('keeps a jittered backoff that is longer than Retry-After', async () => {
      const { sender, fetch, sleeps } = makeSender({ maxRetries: 5 }, { random: () => 0 })
      // The fifth wait has a base of 1600 ms; the lowest jitter makes it 1200 ms.
      fetch
        .mockResolvedValueOnce(makeResponse(503))
        .mockResolvedValueOnce(makeResponse(503))
        .mockResolvedValueOnce(makeResponse(503))
        .mockResolvedValueOnce(makeResponse(503))
        .mockResolvedValueOnce(makeResponse(503, '', { 'Retry-After': '1' }))
        .mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.send(v1Events([msg('u1')]))

      expect(sleeps).toEqual([75, 150, 300, 600, 1200])
    })

    it('clamps a huge Retry-After to 30 seconds', async () => {
      const { sender, fetch, sleeps } = makeSender({ maxRetries: 1 })
      fetch
        .mockResolvedValueOnce(makeResponse(503, '', { 'Retry-After': '9999' }))
        .mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.send(v1Events([msg('u1')]))

      expect(sleeps).toEqual([30_000])
    })

    it('parses an HTTP-date Retry-After as a delay from now', async () => {
      const { sender, fetch, sleeps } = makeSender({ maxRetries: 1 })
      // 20s after the fixed clock start.
      fetch
        .mockResolvedValueOnce(makeResponse(503, '', { 'Retry-After': 'Mon, 01 Jan 2024 00:00:20 GMT' }))
        .mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.send(v1Events([msg('u1')]))

      expect(sleeps).toEqual([20_000])
    })

    it('clamps an HTTP-date Retry-After to 30 seconds', async () => {
      const { sender, fetch, sleeps } = makeSender({ maxRetries: 1 })
      fetch
        .mockResolvedValueOnce(makeResponse(503, '', { 'Retry-After': 'Mon, 01 Jan 2024 00:05:00 GMT' }))
        .mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.send(v1Events([msg('u1')]))

      expect(sleeps).toEqual([30_000])
    })

    it('ignores a past HTTP-date Retry-After and uses backoff', async () => {
      const { sender, fetch, sleeps } = makeSender({ maxRetries: 1 })
      fetch
        .mockResolvedValueOnce(makeResponse(503, '', { 'Retry-After': 'Mon, 01 Jan 2020 00:00:00 GMT' }))
        .mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.send(v1Events([msg('u1')]))

      expect(sleeps).toEqual([100])
    })

    it.each(['0', '-5', 'garbage'])('ignores a non-positive/invalid Retry-After (%s)', async (retryAfter) => {
      const { sender, fetch, sleeps } = makeSender({ maxRetries: 1 })
      fetch
        .mockResolvedValueOnce(makeResponse(503, '', { 'Retry-After': retryAfter }))
        .mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.send(v1Events([msg('u1')]))

      expect(sleeps).toEqual([100])
    })

    it('ignores a Retry-After so large it parses to a non-finite number of seconds', async () => {
      const { sender, fetch, sleeps } = makeSender({ maxRetries: 1 })
      fetch
        .mockResolvedValueOnce(makeResponse(503, '', { 'Retry-After': '9'.repeat(400) }))
        .mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.send(v1Events([msg('u1')]))

      expect(sleeps).toEqual([100])
    })

    it('honors Retry-After on a 200 partial-retry response', async () => {
      const { sender, fetch, sleeps } = makeSender({ maxRetries: 1 })
      fetch
        .mockResolvedValueOnce(makeResponse(200, { results: { u1: { result: 'retry' } } }, { 'Retry-After': '3' }))
        .mockResolvedValueOnce(makeResponse(200, { results: {} }))

      await sender.send(v1Events([msg('u1')]))

      expect(sleeps).toEqual([3000])
    })
  })

  describe('default hooks (no injection)', () => {
    const baseConfig: V1CaptureSenderConfig = {
      host: 'https://t.posthog.com',
      path: '/i/v1/analytics/events',
      apiKey: 'phc_test',
      libraryId: 'posthog-node',
      libraryVersion: '1.2.3',
      historicalMigration: false,
      compressionEnabled: false,
      requestTimeoutMs: 1000,
      maxRetries: 1,
    }

    it('uses the real clock, request-id generator and sleep when not injected', async () => {
      const errors: Error[] = []
      const fetch = vi
        .fn<[string, any], Promise<PostHogFetchResponse>>()
        .mockResolvedValueOnce(makeResponse(503))
        .mockResolvedValueOnce(makeResponse(200, { results: {} }))

      const sender = new V1CaptureSender(baseConfig, { fetch, onError: (e) => errors.push(e) })
      // No injected sleep: the retry backoff schedules a real (fake-timer) setTimeout we must advance.
      const done = sender.send(v1Events([msg('u1')]))
      // The longest first wait, with the highest jitter.
      await vi.advanceTimersByTimeAsync(125)
      await done

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(errors).toEqual([])
      const headers = fetch.mock.calls[0][1].headers
      expect(headers['PostHog-Request-Id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      expect(headers['PostHog-Request-Timestamp']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    })

    it('cancels the backoff timer when aborted', async () => {
      const fetch = vi.fn<[string, any], Promise<PostHogFetchResponse>>().mockResolvedValue(makeResponse(503))
      const controller = new AbortController()
      const sender = new V1CaptureSender(baseConfig, { fetch, onError: () => {} })

      const done = sender.send(v1Events([msg('u1')]), { signal: controller.signal })
      await vi.advanceTimersByTimeAsync(0)
      controller.abort()
      await done

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('removes every abort listener it adds to a long-lived signal', async () => {
      const fetch = vi
        .fn<[string, any], Promise<PostHogFetchResponse>>()
        .mockResolvedValueOnce(makeResponse(503))
        .mockResolvedValueOnce(makeResponse(200, { results: {} }))
      const { signal } = new AbortController()
      const added = vi.spyOn(signal, 'addEventListener')
      const removed = vi.spyOn(signal, 'removeEventListener')
      const sender = new V1CaptureSender(baseConfig, { fetch, onError: () => {} })

      const done = sender.send(v1Events([msg('u1')]), { signal })
      // The longest first wait, with the highest jitter.
      await vi.advanceTimersByTimeAsync(125)
      await done

      expect(fetch).toHaveBeenCalledTimes(2)
      const removedListeners = new Set(removed.mock.calls.map(([, listener]) => listener))
      const leaked = added.mock.calls.filter(([, listener]) => !removedListeners.has(listener))
      expect(added.mock.calls.length).toBeGreaterThan(0)
      expect(leaked).toEqual([])
    })

    it('uses the real gzip compressor when not injected', async () => {
      const fetch = vi
        .fn<[string, any], Promise<PostHogFetchResponse>>()
        .mockResolvedValueOnce(makeResponse(200, { results: {} }))

      const sender = new V1CaptureSender({ ...baseConfig, compressionEnabled: true }, { fetch, onError: () => {} })
      await sender.send(v1Events([msg('u1')]))

      // The default compressor is the platform gzip codec: it compresses where
      // supported and transparently falls back to an uncompressed string where it
      // is not (e.g. the edge runtime has no CompressionStream).
      if (isGzipSupported()) {
        expect(fetch.mock.calls[0][1].headers['Content-Encoding']).toBe('gzip')
        expect(fetch.mock.calls[0][1].body).toBeInstanceOf(Blob)
      } else {
        expect(fetch.mock.calls[0][1].headers['Content-Encoding']).toBeUndefined()
        expect(typeof fetch.mock.calls[0][1].body).toBe('string')
      }
    })
  })
})
