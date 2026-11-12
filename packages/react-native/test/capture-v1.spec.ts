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
})
