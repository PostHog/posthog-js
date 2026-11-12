import { PostHog, PostHogCustomStorage, PostHogOptions } from '../src'

type CaptureRequest = {
  path: string
  headers: Record<string, string>
  body: { batch: { event: string; uuid: string; properties?: Record<string, unknown> }[] }
}

const AI_PATH = '/i/v1/ai/events'
const ANALYTICS_PATH = '/i/v1/analytics/events'

describe('React Native captureAi', () => {
  const originalFetch = (globalThis as any).window.fetch
  let requests: CaptureRequest[]
  let respond: (
    request: CaptureRequest
  ) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>
  let posthog: PostHog | undefined
  let cache: Record<string, string>
  let storage: PostHogCustomStorage

  beforeAll(() => {
    vi.useRealTimers()
  })

  afterAll(() => {
    ;(globalThis as any).window.fetch = originalFetch
    vi.useFakeTimers()
  })

  beforeEach(() => {
    requests = []
    cache = {}
    storage = {
      getItem: async (key) => cache[key] ?? null,
      setItem: async (key, value) => {
        cache[key] = value
      },
    }
    respond = () => ({ status: 200, body: { results: {} } })
    ;(globalThis as any).window.fetch = vi.fn(async (url: string, options: any) => {
      const path = new URL(String(url)).pathname
      if (path !== AI_PATH && path !== ANALYTICS_PATH) {
        return { status: 200, json: async () => ({}), text: async () => '{}' }
      }
      const request = { path, headers: options.headers, body: JSON.parse(options.body) }
      requests.push(request)
      const { status, body } = await respond(request)
      return {
        status,
        headers: { get: () => null },
        json: async () => body,
        text: async () => JSON.stringify(body ?? {}),
      }
    })
  })

  afterEach(async () => {
    respond = () => ({ status: 200, body: { results: {} } })
    await posthog?.shutdown()
    posthog = undefined
  })

  const newPostHog = async (options: PostHogOptions = {}): Promise<PostHog> => {
    posthog = new PostHog('test-token', {
      customStorage: storage,
      flushInterval: 0,
      preloadFeatureFlags: false,
      captureAppLifecycleEvents: false,
      captureAiCompression: 'none',
      disableCompression: true,
      ...options,
    })
    await posthog.ready()
    return posthog
  }

  const sent = (path: string): string[][] =>
    requests.filter((request) => request.path === path).map((request) => request.body.batch.map((event) => event.event))

  it('sends captureAi events to the AI endpoint and returns their uuid', async () => {
    const client = await newPostHog()

    const uuid = client.captureAi('$ai_generation', { $ai_model: 'gpt-4o' })
    await client.flush()

    expect(sent(AI_PATH)).toEqual([['$ai_generation']])
    expect(sent(ANALYTICS_PATH)).toEqual([])
    const [event] = requests[0].body.batch
    expect(event.uuid).toBe(uuid)
    expect(event.properties).toMatchObject({ $ai_model: 'gpt-4o' })
    expect(requests[0].headers.Authorization).toBe('Bearer test-token')
  })

  it('keeps $ai_ events captured with capture() on the analytics endpoint', async () => {
    const client = await newPostHog()

    client.capture('$ai_generation')
    await client.flush()

    expect(sent(ANALYTICS_PATH)).toEqual([['$ai_generation']])
    expect(sent(AI_PATH)).toEqual([])
  })

  it('sends a non-AI event given to captureAi to the AI endpoint and reports the misroute', async () => {
    const client = await newPostHog()
    const errors: unknown[] = []
    client.on('error', (error) => errors.push(error))
    respond = (request) => ({
      status: 200,
      body: { results: { [request.body.batch[0].uuid]: { result: 'drop', details: 'misrouted_event' } } },
    })

    const uuid = client.captureAi('button_clicked')
    await client.flush()

    expect(sent(AI_PATH)).toEqual([['button_clicked']])
    expect(errors).toEqual([expect.objectContaining({ drops: [{ uuid, details: 'misrouted_event' }] })])
  })

  it('drops an event over captureAiMaxEventBytes with a log that names only the event and its size', async () => {
    const logs = (['debug', 'info', 'log', 'warn', 'error'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {})
    )
    const client = await newPostHog({ captureAiMaxEventBytes: 2000 })
    client.debug(true)

    try {
      expect(client.captureAi('$ai_generation', { prompt: `SECRET-MARKER ${'x'.repeat(5000)}` })).toBeUndefined()
      expect(client.captureAi('$ai_span', { name: 'small' })).toEqual(expect.any(String))
      await client.flush()

      const output = logs.flatMap((spy) => spy.mock.calls.map((args) => args.join(' '))).join('\n')
      expect(output).toMatch(/Dropping AI event "\$ai_generation": \d+ bytes is over the 2000-byte limit/)
      expect(output).not.toContain('SECRET-MARKER')
      expect(sent(AI_PATH)).toEqual([['$ai_span']])
    } finally {
      await client.shutdown()
      posthog = undefined
      logs.forEach((spy) => spy.mockRestore())
    }
  })

  it('uses the default limit when captureAiMaxEventBytes is above it', async () => {
    const client = await newPostHog({ captureAiMaxEventBytes: 1024 * 1024 * 1024 })

    expect(client.captureAi('$ai_generation', { blob: 'x'.repeat(1024 * 1024) })).toEqual(expect.any(String))
    await client.flush()

    expect(sent(AI_PATH)).toEqual([['$ai_generation']])
  })

  it('starts a new AI request before a batch would pass 5 MiB of event bytes', async () => {
    const client = await newPostHog()
    const twoMiB = 'x'.repeat(2 * 1024 * 1024)

    client.captureAi('$ai_generation', { blob: twoMiB, index: 0 })
    client.captureAi('$ai_generation', { blob: twoMiB, index: 1 })
    client.captureAi('$ai_generation', { blob: twoMiB, index: 2 })
    await client.flush()

    expect(requests.map((request) => request.body.batch.map((event) => event.properties?.index))).toEqual([[0, 1], [2]])
  })

  it('keeps the newest events when the AI queue is over captureAiMaxQueueSize', async () => {
    const client = await newPostHog({ captureAiMaxQueueSize: 2, flushAt: 10 })

    client.captureAi('$ai_generation', { index: 0 })
    client.captureAi('$ai_generation', { index: 1 })
    client.captureAi('$ai_generation', { index: 2 })
    await client.flush()

    expect(requests.map((request) => request.body.batch.map((event) => event.properties?.index))).toEqual([[1, 2]])
  })

  it('does not hold analytics events behind a stuck AI request', async () => {
    let releaseAi: () => void = () => {}
    respond = (request) =>
      request.path === AI_PATH
        ? new Promise((resolve) => {
            releaseAi = () => resolve({ status: 200, body: { results: {} } })
          })
        : { status: 200, body: { results: {} } }
    const client = await newPostHog({ flushAt: 1 })

    client.captureAi('$ai_generation')
    client.capture('button_clicked')

    await vi.waitFor(() => expect(sent(ANALYTICS_PATH)).toEqual([['button_clicked']]), { timeout: 2000 })
    releaseAi()
    await client.flush()
    expect(sent(AI_PATH)).toEqual([['$ai_generation']])
  })

  it('keeps AI events after a retryable status without failing flush() or shutdown()', async () => {
    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    const client = await newPostHog()

    client.captureAi('$ai_generation')
    client.capture('button_clicked')
    await expect(client.flush()).resolves.toBeUndefined()
    await expect(client.shutdown()).resolves.toBeUndefined()
    const requestsAtShutdown = requests.length

    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(requests.length).toBe(requestsAtShutdown)
    expect(sent(ANALYTICS_PATH)).toEqual([['button_clicked']])
    posthog = undefined

    // The kept event is sent by the next launch.
    respond = () => ({ status: 200, body: { results: {} } })
    requests = []
    const next = await newPostHog()
    await next.flush()
    expect(sent(AI_PATH)).toEqual([['$ai_generation']])
  })

  it('returns undefined and queues nothing when before_send drops the event', async () => {
    const client = await newPostHog({ before_send: () => null })

    expect(client.captureAi('$ai_generation')).toBeUndefined()
    await client.flush()

    expect(requests).toEqual([])
  })

  it('compresses AI requests with gzip by default, separately from disableCompression', async () => {
    const client = await newPostHog({ captureAiCompression: undefined, disableCompression: true })
    const fetchMock = (globalThis as any).window.fetch as vi.Mock
    fetchMock.mockImplementation(async (url: string, options: any) => {
      const path = new URL(String(url)).pathname
      requests.push({ path, headers: options.headers, body: { batch: [] } })
      return { status: 200, headers: { get: () => null }, json: async () => ({ results: {} }), text: async () => '{}' }
    })

    client.captureAi('$ai_generation')
    client.capture('button_clicked')
    await client.flush()

    const encoding = (path: string): string | undefined =>
      requests.find((request) => request.path === path)?.headers['Content-Encoding']
    expect(encoding(AI_PATH)).toBe('gzip')
    expect(encoding(ANALYTICS_PATH)).toBeUndefined()
  })

  it('does not resend AI events from routine analytics flushes during the AI resend wait', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(1)
    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    const client = await newPostHog({ flushAt: 1 })
    client.captureAi('$ai_generation')
    await new Promise((resolve) => setTimeout(resolve, 100))
    for (const name of ['first', 'second', 'third']) {
      client.capture(name)
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    randomSpy.mockRestore()

    expect(sent(AI_PATH)).toEqual([['$ai_generation']])
    expect(sent(ANALYTICS_PATH).flat()).toEqual(['first', 'second', 'third'])
  })

  it('does not send AI events left from an earlier launch when the SDK is disabled', async () => {
    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    const earlier = await newPostHog()
    earlier.captureAi('$ai_generation')
    await earlier.shutdown()
    requests = []
    respond = () => ({ status: 200, body: { results: {} } })

    const disabled = await newPostHog({ disabled: true })
    await disabled.flush()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(sent(AI_PATH)).toEqual([])
  })
})
