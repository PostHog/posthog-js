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
    await posthog.shutdown()
  })

  const sentEvents = (): string[][] => requests.map((request) => request.body.batch.map((event) => event.event))

  it('keeps events capture marks for retry and sends them on the next flush', async () => {
    respond = (request) => ({
      status: 200,
      body: { results: Object.fromEntries(request.body.batch.map((event) => [event.uuid, { result: 'retry' }])) },
    })
    posthog.capture('kept')
    await expect(posthog.flush()).resolves.toBeUndefined()

    respond = () => ({ status: 200, body: { results: {} } })
    await posthog.flush()

    expect(sentEvents()).toEqual([['kept'], ['kept']])
  })

  it('keeps events after a retryable status and waits before an automatic resend', async () => {
    respond = () => ({ status: 503 })
    posthog.capture('kept')
    await posthog.flush()

    // An automatic flush during the wait does not send.
    await (posthog as any).flushAutomatic()
    expect(sentEvents()).toEqual([['kept']])

    respond = () => ({ status: 200, body: { results: {} } })
    await posthog.flush()
    expect(sentEvents()).toEqual([['kept'], ['kept']])
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

  // With Math.random stubbed to 0 the first resend waits 750 ms.
  const stubJitter = () => vi.spyOn(Math, 'random').mockReturnValue(0)
  const queuedEvents = (): string[] =>
    ((posthog as any).getPersistedProperty((posthog as any).persistedQueueKeyForRoute('default')) ?? []).map(
      (item: any) => item.message?.event
    )

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

  it('keeps only the retried event and a newer capture, and sends exactly those next', async () => {
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
    await posthog.flush()

    expect(sentEvents()).toEqual([
      ['a', 'b', 'c'],
      ['b', 'd'],
    ])
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
