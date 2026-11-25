import { PostHog } from '../src'

type CaptureRequest = { headers: Record<string, string>; body: { batch: { event: string; uuid: string }[] } }

const CAPTURE_PATH = '/i/v1/analytics/events'

describe('React Native capture v1 delivery', () => {
  const originalFetch = (globalThis as any).window.fetch
  let requests: CaptureRequest[]
  let respond: (request: CaptureRequest) => { status: number; body?: unknown; headers?: Record<string, string> }
  let posthog: PostHog

  beforeAll(() => {
    vi.useRealTimers()
  })

  afterAll(() => {
    ;(globalThis as any).window.fetch = originalFetch
    vi.useFakeTimers()
  })

  beforeEach(async () => {
    requests = []
    respond = () => ({ status: 200, body: { results: {} } })
    ;(globalThis as any).window.fetch = vi.fn(async (url: string, options: any) => {
      if (!String(url).includes(CAPTURE_PATH)) {
        return { status: 200, json: async () => ({}), text: async () => '{}' }
      }
      const request = { headers: options.headers, body: JSON.parse(options.body) }
      requests.push(request)
      const { status, body, headers = {} } = respond(request)
      return {
        status,
        headers: { get: (name: string) => headers[name] ?? null },
        json: async () => body,
        text: async () => JSON.stringify(body ?? {}),
      }
    })
    posthog = new PostHog('test-token', {
      persistence: 'memory',
      flushInterval: 0,
      preloadFeatureFlags: false,
      disableCompression: true,
      captureAppLifecycleEvents: false,
    })
    await posthog.ready()
  })

  afterEach(async () => {
    respond = () => ({ status: 200, body: { results: {} } })
    ;(posthog as any)._captureResendAt = 0
    await posthog.shutdown()
  })

  const sentEvents = (): string[][] => requests.map((request) => request.body.batch.map((event) => event.event))
  // Ends the wait capture asked for, as the resend timer does.
  const endResendWait = (): void => {
    ;(posthog as any)._captureResendAt = 0
  }
  const requestIdentity = (request: CaptureRequest) => ({
    requestId: request.headers['PostHog-Request-Id'],
    attempt: request.headers['PostHog-Attempt'],
    createdAt: (request.body as any).created_at,
  })

  it('keeps events capture marks for retry and sends them on the next flush', async () => {
    respond = (request) => ({
      status: 200,
      body: { results: Object.fromEntries(request.body.batch.map((event) => [event.uuid, { result: 'retry' }])) },
    })
    posthog.capture('kept')
    await expect(posthog.flush()).resolves.toBeUndefined()

    respond = () => ({ status: 200, body: { results: {} } })
    endResendWait()
    await posthog.flush()

    expect(sentEvents()).toEqual([['kept'], ['kept']])
  })

  it.each([
    ['a retryable status', () => ({ status: 503 })],
    [
      'no response',
      () => {
        throw new TypeError('Network request failed')
      },
    ],
  ])('holds every flush after %s, then resends as the next attempt of the same request', async (_, failure) => {
    respond = failure
    posthog.capture('kept')
    await posthog.flush()

    respond = () => ({ status: 200, body: { results: {} } })
    await (posthog as any).flushAutomatic()
    await posthog.flush()
    expect(sentEvents()).toEqual([['kept']])

    endResendWait()
    await posthog.flush()
    expect(sentEvents()).toEqual([['kept'], ['kept']])
    const [first, resend] = requests.map(requestIdentity)
    expect(resend).toEqual({ ...first, attempt: '2' })
  })

  it('leaves redirects to the platform, so react-native-web follows a 307 or 308', async () => {
    posthog.capture('event')
    await posthog.flush()

    const captureCall = ((globalThis as any).window.fetch as vi.Mock).mock.calls.find(([url]) =>
      String(url).includes(CAPTURE_PATH)
    )
    expect(captureCall?.[1]).not.toHaveProperty('redirect')
  })

  it('logs why events are kept, so a proxy without the capture route shows up in debug mode', async () => {
    const info = vi.spyOn((posthog as any)._logger, 'info')
    respond = () => ({ status: 404 })
    posthog.capture('kept')
    await posthog.flush()

    expect(info).toHaveBeenCalledWith('Keeping 1 events to send again: HTTP 404.')
  })

  it('halves a batch that got a 413 and sends the same events', async () => {
    respond = (request) => (request.body.batch.length > 1 ? { status: 413 } : { status: 200, body: { results: {} } })
    posthog.capture('first')
    posthog.capture('second')
    await posthog.flush()

    expect(sentEvents()).toEqual([['first', 'second'], ['first'], ['second']])
  })

  it('matches the server verdict to an event captured with an uppercase uuid', async () => {
    const uuid = '0198C0DE-1234-7ABC-8DEF-0123456789AB'
    const errors: unknown[] = []
    posthog.on('error', (error) => errors.push(error))
    respond = (request) => ({
      status: 200,
      body: { results: { [request.body.batch[0].uuid]: { result: 'drop', details: 'invalid_options' } } },
    })
    posthog.capture('dropped', {}, { uuid })
    await posthog.flush()

    expect(requests[0].body.batch[0].uuid).toBe(uuid.toLowerCase())
    expect(errors).toEqual([
      expect.objectContaining({ drops: [{ uuid: uuid.toLowerCase(), details: 'invalid_options' }] }),
    ])
  })

  it('reports an event dropped before sending on the error channel', async () => {
    const uuid = '0198c0de-1234-7abc-8def-0123456789ab'
    const errors: unknown[] = []
    posthog.on('error', (error) => errors.push(error))
    posthog.capture('\ud800', {}, { uuid })
    posthog.capture('sent')
    await posthog.flush()

    expect(sentEvents()).toEqual([['sent']])
    expect(errors).toEqual([
      expect.objectContaining({
        name: 'CaptureError',
        drops: [{ uuid, details: 'invalid event' }],
        retryExhausted: [],
      }),
    ])
  })

  it('drops an event that cannot be serialized and still sends the rest of its batch', async () => {
    const uuid = '0198c0de-1234-7abc-8def-0123456789ac'
    const errors: unknown[] = []
    posthog.on('error', (error) => errors.push(error))
    posthog.capture('before')
    posthog.capture(
      'unserializable',
      {
        value: {
          toJSON() {
            throw new Error('boom')
          },
        },
      },
      { uuid }
    )
    posthog.capture('after')
    await expect(posthog.flush()).resolves.toBeUndefined()

    expect(sentEvents()).toEqual([['before', 'after']])
    expect(errors).toEqual([
      expect.objectContaining({
        name: 'CaptureError',
        drops: [{ uuid, details: 'unserializable event' }],
        retryExhausted: [],
      }),
    ])
  })

  // With Math.random stubbed to 0 the first resend waits 750 ms.
  const stubJitter = () => vi.spyOn(Math, 'random').mockReturnValue(0)
  const queuedEvents = (): string[] =>
    ((posthog as any).getPersistedProperty((posthog as any).persistedQueueKeyForRoute('default')) ?? []).map(
      (item: any) => item.message?.event
    )

  const throwingErrorListener = (): void => {
    vi.spyOn((posthog as any)._logger, 'error').mockImplementation(() => {})
    vi.spyOn((posthog as any)._logger, 'warn').mockImplementation(() => {})
    posthog.on('error', (err: any) => {
      void err.response.status
    })
  }

  it('still sends valid events and resolves flush when an error listener throws on a local drop', async () => {
    throwingErrorListener()
    posthog.capture('\ud800')
    posthog.capture('valid')

    await expect(posthog.flush()).resolves.toBeUndefined()
    expect(sentEvents()).toEqual([['valid']])
    expect(queuedEvents()).toEqual([])
  })

  it('keeps retried events and resolves flush when an error listener throws on a partial drop', async () => {
    throwingErrorListener()
    respond = (request) => ({
      status: 200,
      body: {
        results: {
          [request.body.batch[0].uuid]: { result: 'drop', details: 'invalid_options' },
          [request.body.batch[1].uuid]: { result: 'retry', details: 'not_persisted' },
        },
      },
    })
    posthog.capture('dropped')
    posthog.capture('retried')

    await expect(posthog.flush()).resolves.toBeUndefined()
    expect(queuedEvents()).toEqual(['retried'])
  })

  it('resends automatically even when the resend timer fires before the wait ends', async () => {
    const randomSpy = stubJitter()
    respond = () => ({ status: 503 })
    posthog.capture('kept')
    await posthog.flush()

    respond = () => ({ status: 200, body: { results: {} } })
    const realNow = Date.now
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() - 5000)
    try {
      await vi.waitFor(() => expect(sentEvents()).toEqual([['kept'], ['kept']]), { timeout: 3000 })
    } finally {
      nowSpy.mockRestore()
      randomSpy.mockRestore()
    }
  })

  it('waits out Retry-After during shutdown when it fits in the timeout', async () => {
    respond = () => ({ status: 503, headers: { 'Retry-After': '1' } })
    posthog.capture('kept')
    await posthog.flush()

    respond = () => ({ status: 200, body: { results: {} } })
    const start = Date.now()
    await posthog.shutdown(5000)

    expect(Date.now() - start).toBeGreaterThanOrEqual(900)
    expect(sentEvents()).toEqual([['kept'], ['kept']])
  })

  it('stops a shutdown drain without sending when the wait would pass the timeout', async () => {
    vi.spyOn((posthog as any)._logger, 'warn').mockImplementation(() => {})
    respond = () => ({ status: 503, headers: { 'Retry-After': '30' } })
    posthog.capture('kept')
    await posthog.flush()

    const start = Date.now()
    await posthog.shutdown(2000)

    expect(Date.now() - start).toBeLessThan(1000)
    expect(sentEvents()).toEqual([['kept']])
    expect(queuedEvents()).toEqual(['kept'])
  })

  it('sends nothing after shutdown when the final flush is deferred', async () => {
    const randomSpy = stubJitter()
    respond = () => ({ status: 503 })
    posthog.capture('kept')
    await posthog.shutdown()
    randomSpy.mockRestore()
    const requestsAtShutdown = requests.length

    await new Promise((resolve) => setTimeout(resolve, 1000))

    expect(requests.length).toBe(requestsAtShutdown)
  })

  it('sends no background resend while logs are still shutting down', async () => {
    const randomSpy = stubJitter()
    vi.spyOn((posthog as any)._logger, 'warn').mockImplementation(() => {})
    const fetchMock = (globalThis as any).window.fetch as vi.Mock
    const respondNow = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url: string, options: any) => {
      if (String(url).includes('/i/v1/logs')) {
        await new Promise((resolve) => setTimeout(resolve, 1100))
      }
      return respondNow(url, options)
    })
    respond = () => ({ status: 503 })
    posthog.capture('kept')
    posthog.captureLog({ body: 'slow log' })

    await posthog.shutdown(5000)
    randomSpy.mockRestore()

    expect(sentEvents()).toEqual([['kept']])
  })

  it('stops after one deferred retry following a partial retry during shutdown', async () => {
    const randomSpy = stubJitter()
    vi.spyOn((posthog as any)._logger, 'warn').mockImplementation(() => {})
    let attempt = 0
    respond = (request) =>
      ++attempt === 1
        ? {
            status: 200,
            body: {
              results: {
                [request.body.batch[0].uuid]: { result: 'ok' },
                [request.body.batch[1].uuid]: { result: 'retry', details: 'not_persisted' },
              },
            },
          }
        : { status: 503 }
    posthog.capture('accepted')
    posthog.capture('retried')

    await posthog.shutdown(6000)
    randomSpy.mockRestore()

    expect(sentEvents()).toEqual([['accepted', 'retried'], ['retried']])
  })

  it('sends nothing after shutdown when a capture response arrives after the shutdown timeout', async () => {
    const randomSpy = stubJitter()
    let releaseResponse: () => void = () => {}
    const responseHeld = new Promise<void>((resolve) => (releaseResponse = resolve))
    respond = () => ({ status: 503 })
    const fetchMock = (globalThis as any).window.fetch as vi.Mock
    const respondNow = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url: string, options: any) => {
      if (String(url).includes(CAPTURE_PATH)) {
        await responseHeld
      }
      return respondNow(url, options)
    })
    vi.spyOn((posthog as any)._logger, 'critical').mockImplementation(() => {})
    posthog.capture('kept')
    await posthog.shutdown(50)
    releaseResponse()

    await new Promise((resolve) => setTimeout(resolve, 1500))
    randomSpy.mockRestore()

    expect(sentEvents()).toEqual([['kept']])
  })

  it('keeps a stored event whose uuid is not a valid UUID when capture asks to retry it', async () => {
    ;(posthog as any).setPersistedProperty((posthog as any).persistedQueueKeyForRoute('default'), [
      { message: { event: 'legacy', distinct_id: 'user', uuid: 'legacy-not-a-uuid', properties: {} } },
    ])
    respond = (request) => ({
      status: 200,
      body: { results: Object.fromEntries(request.body.batch.map((event) => [event.uuid, { result: 'retry' }])) },
    })

    await posthog.flush()

    expect(queuedEvents()).toEqual(['legacy'])
  })

  it('resends only the retried event as the same request, then a newer capture in a new one', async () => {
    let capturedDuringRequest = false
    respond = (request) => {
      if (!capturedDuringRequest) {
        capturedDuringRequest = true
        posthog.capture('d')
      }
      return {
        status: 200,
        body: {
          results: Object.fromEntries(
            request.body.batch.map((event) => [event.uuid, { result: event.event === 'b' ? 'retry' : 'ok' }])
          ),
        },
      }
    }
    posthog.capture('a')
    posthog.capture('b')
    posthog.capture('c')
    await posthog.flush()
    expect(queuedEvents()).toEqual(['b', 'd'])

    respond = () => ({ status: 200, body: { results: {} } })
    endResendWait()
    await posthog.flush()

    expect(sentEvents()).toEqual([['a', 'b', 'c'], ['b'], ['d']])
    const [first, resend, newer] = requests.map(requestIdentity)
    expect(resend).toEqual({ ...first, attempt: '2' })
    expect(newer.requestId).not.toBe(first.requestId)
    expect(newer.attempt).toBe('1')
  })

  it('starts a new request when an event it was resending has left the queue', async () => {
    respond = () => ({ status: 503 })
    posthog.capture('kept')
    await posthog.flush()

    ;(posthog as any).setPersistedProperty((posthog as any).persistedQueueKeyForRoute('default'), [])
    posthog.capture('newer')
    respond = () => ({ status: 200, body: { results: {} } })
    endResendWait()
    await posthog.flush()

    expect(sentEvents()).toEqual([['kept'], ['newer']])
    expect(requests[1].headers['PostHog-Request-Id']).not.toBe(requests[0].headers['PostHog-Request-Id'])
    expect(requests[1].headers['PostHog-Attempt']).toBe('1')
  })

  it('does not keep or resend a duplicate of an event capture asks to retry', async () => {
    const uuid = '0198c0de-1234-7abc-8def-0123456789ad'
    respond = () => ({
      status: 200,
      body: { results: { [uuid]: { result: 'retry', details: 'not_persisted', duplicates_dropped: 1 } } },
    })
    posthog.capture('first', {}, { uuid })
    posthog.capture('second', {}, { uuid })
    await posthog.flush()
    expect(queuedEvents()).toEqual(['first'])

    respond = () => ({ status: 200, body: { results: {} } })
    endResendWait()
    await posthog.flush()
    expect(sentEvents()).toEqual([['first', 'second'], ['first']])
  })

  it('holds a flush queued behind a send that gets a 503', async () => {
    let releaseFirst: () => void = () => {}
    const firstHeld = new Promise<void>((resolve) => (releaseFirst = resolve))
    const fetchMock = (globalThis as any).window.fetch as vi.Mock
    const respondNow = fetchMock.getMockImplementation()!
    let captureCalls = 0
    fetchMock.mockImplementation(async (url: string, options: any) => {
      if (String(url).includes(CAPTURE_PATH) && ++captureCalls === 1) {
        await firstHeld
      }
      return respondNow(url, options)
    })
    respond = () => ({ status: 503, headers: { 'Retry-After': '30' } })
    posthog.capture('first')
    const firstFlush = (posthog as any).flushAutomatic()
    await vi.waitFor(() => expect(captureCalls).toBe(1))
    posthog.capture('second')
    const secondFlush = posthog.flush()
    releaseFirst()
    await Promise.all([firstFlush, secondFlush])

    expect(sentEvents()).toEqual([['first']])
  })

  it('keeps jitter once the resend wait reaches 30 seconds', () => {
    const randomSpy = stubJitter()
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    ;(posthog as any)._captureResendCount = 6
    ;(posthog as any)._scheduleCaptureResend(undefined)

    expect((posthog as any)._captureResendAt - now).toBe(22_500)
    randomSpy.mockRestore()
    vi.mocked(Date.now).mockRestore()
  })

  it('waits at least Retry-After before an automatic resend, up to 30 seconds', async () => {
    const randomSpy = stubJitter()
    const now = Date.now()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now)
    posthog.capture('kept')
    respond = () => ({ status: 503, headers: { 'Retry-After': '7' } })
    await posthog.flush()
    expect((posthog as any)._captureResendAt - now).toBe(7000)

    respond = () => ({ status: 503, headers: { 'Retry-After': '120' } })
    endResendWait()
    await posthog.flush()
    expect((posthog as any)._captureResendAt - now).toBe(30_000)
    nowSpy.mockRestore()
    randomSpy.mockRestore()
  })

  it('clears a pending resend once a flush gets through', async () => {
    respond = () => ({ status: 503 })
    posthog.capture('kept')
    await posthog.flush()
    expect((posthog as any)._captureResendTimer).toBeDefined()

    respond = () => ({ status: 200, body: { results: {} } })
    endResendWait()
    await posthog.flush()

    expect((posthog as any)._captureResendTimer).toBeUndefined()
  })

  it('does not emit flush when every event is kept for later', async () => {
    const flushed: unknown[] = []
    posthog.on('flush', (messages) => flushed.push(messages))
    respond = () => ({ status: 503 })
    posthog.capture('kept')
    await posthog.flush()

    expect(flushed).toEqual([])
  })

  it.each([400, 401, 402])('drops the batch after a %s, reports it and schedules no resend', async (status) => {
    const errors: unknown[] = []
    posthog.on('error', (error) => errors.push(error))
    respond = () => ({ status })
    posthog.capture('dropped')
    await expect(posthog.flush()).resolves.toBeUndefined()

    expect(queuedEvents()).toEqual([])
    expect(errors).toEqual([expect.objectContaining({ name: 'CaptureError' })])
    expect((posthog as any)._captureResendTimer).toBeUndefined()
  })

  it('drops a single event that gets a 413 instead of retrying it', async () => {
    const errors: unknown[] = []
    posthog.on('error', (error) => errors.push(error))
    respond = () => ({ status: 413 })
    posthog.capture('too-large')
    await posthog.flush()

    expect(sentEvents()).toEqual([['too-large']])
    expect(queuedEvents()).toEqual([])
    expect(errors).toEqual([expect.objectContaining({ name: 'CaptureError' })])
  })

  it('reports an event dropped before sending once when its batch is halved after a 413', async () => {
    const errors: unknown[] = []
    posthog.on('error', (error) => errors.push(error))
    respond = (request) => (request.body.batch.length > 1 ? { status: 413 } : { status: 200, body: { results: {} } })
    posthog.capture('\ud800')
    posthog.capture('first')
    posthog.capture('second')
    await posthog.flush()

    expect(sentEvents()).toEqual([['first', 'second'], ['first'], ['second']])
    expect(errors).toHaveLength(1)
  })

  it('starts a new request before a batch would pass 5 MiB of event bytes', async () => {
    const twoMiB = 'x'.repeat(2 * 1024 * 1024)
    posthog.capture('first', { blob: twoMiB })
    posthog.capture('second', { blob: twoMiB })
    posthog.capture('third', { blob: twoMiB })

    await posthog.flush()

    expect(sentEvents()).toEqual([['first', 'second'], ['third']])
  })
})
