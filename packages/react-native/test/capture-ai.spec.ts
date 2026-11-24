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

  it('sends trace feedback to the AI endpoint', async () => {
    const client = await newPostHog()

    client.captureTraceFeedback(42, 'great answer')
    await client.flush()

    expect(sent(AI_PATH)).toEqual([['$ai_feedback']])
    expect(sent(ANALYTICS_PATH)).toEqual([])
    expect(requests[0].body.batch[0].properties).toMatchObject({
      $ai_trace_id: '42',
      $ai_feedback_text: 'great answer',
    })
  })

  it('sends trace metrics to the AI endpoint', async () => {
    const client = await newPostHog()

    client.captureTraceMetric('trace-1', 'latency', 1.5)
    await client.flush()

    expect(sent(AI_PATH)).toEqual([['$ai_metric']])
    expect(sent(ANALYTICS_PATH)).toEqual([])
    expect(requests[0].body.batch[0].properties).toMatchObject({
      $ai_trace_id: 'trace-1',
      $ai_metric_name: 'latency',
      $ai_metric_value: '1.5',
    })
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

  it('reports AI events dropped before sending on posthog.on("error")', async () => {
    const client = await newPostHog({ captureAiMaxEventBytes: 2000, captureAiMaxQueueSize: 1, flushAt: 10 })
    vi.spyOn((client as any)._logger, 'warn').mockImplementation(() => {})
    const errors: any[] = []
    client.on('error', (error) => errors.push(error))

    expect(client.captureAi('$ai_generation', { blob: 'x'.repeat(5000) })).toBeUndefined()
    const first = client.captureAi('$ai_span', { name: 'first' })
    client.captureAi('$ai_span', { name: 'second' })

    expect(errors.map((error) => error.drops)).toEqual([
      [{ uuid: expect.any(String), details: 'event too large' }],
      [{ uuid: first, details: 'queue full' }],
    ])
    expect(errors[0].endpoint).toBe('/i/v1/ai/events')
  })

  it('keeps captureAi() from throwing when an error listener throws', async () => {
    const client = await newPostHog({ captureAiMaxEventBytes: 2000 })
    vi.spyOn((client as any)._logger, 'warn').mockImplementation(() => {})
    vi.spyOn((client as any)._logger, 'error').mockImplementation(() => {})
    client.on('error', () => {
      throw new Error('listener failed')
    })

    expect(() => client.captureAi('$ai_generation', { blob: 'x'.repeat(5000) })).not.toThrow()
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

  it('does not report an analytics shutdown timeout because of a stuck AI request', async () => {
    const logs = (['debug', 'info', 'log', 'warn', 'error'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {})
    )
    respond = (request) => (request.path === AI_PATH ? new Promise(() => {}) : { status: 200, body: { results: {} } })
    const client = await newPostHog({ flushAt: 10 })

    try {
      client.captureAi('$ai_generation')
      client.capture('button_clicked')
      await client.shutdown(300)

      const output = logs.flatMap((spy) => spy.mock.calls.map((args) => args.join(' '))).join('\n')
      expect(output).not.toContain('Timeout while shutting down')
      expect(sent(ANALYTICS_PATH)).toEqual([['button_clicked']])
      expect(sent(AI_PATH)).toEqual([['$ai_generation']])
    } finally {
      posthog = undefined
      logs.forEach((spy) => spy.mockRestore())
    }
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

  it('sends AI events once the queue is full when captureAiMaxQueueSize is below flushAt', async () => {
    const client = await newPostHog({ flushAt: 20, captureAiMaxQueueSize: 2 })

    client.captureAi('$ai_generation', { index: 0 })
    client.captureAi('$ai_generation', { index: 1 })

    await vi.waitFor(() => expect(sent(AI_PATH)).toEqual([['$ai_generation', '$ai_generation']]))
  })

  it('stores kept AI events with only their uuid, JSON and sizes', async () => {
    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    const client = await newPostHog()
    client.captureAi('$ai_generation')
    await client.flush()
    await client.shutdown()
    posthog = undefined

    const [stored] = JSON.parse(cache['.posthog-rn-ai-test-token.json']).content.ai_queue
    expect(Object.keys(stored).sort()).toEqual(['bytes', 'json', 'propertiesBytes', 'uuid'])
  })

  it('never sends AI events stored for one project with another project token', async () => {
    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    const earlier = await newPostHog()
    earlier.captureAi('$ai_generation')
    await earlier.flush()
    await earlier.shutdown()
    posthog = undefined

    respond = () => ({ status: 200, body: { results: {} } })
    requests = []
    posthog = new PostHog('other-token', {
      customStorage: storage,
      flushInterval: 0,
      preloadFeatureFlags: false,
      captureAppLifecycleEvents: false,
      captureAiCompression: 'none',
    })
    await posthog.ready()
    await posthog.flush()

    expect(sent(AI_PATH)).toEqual([])
    expect(JSON.parse(cache['.posthog-rn-ai-test-token.json']).content.ai_queue).toHaveLength(1)
  })

  it('persists only the newest 5 MiB of kept AI events for the next launch', async () => {
    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    const earlier = await newPostHog({ flushAt: 10 })
    const twoMiB = 'x'.repeat(2 * 1024 * 1024)
    for (const index of [0, 1, 2]) {
      earlier.captureAi('$ai_generation', { blob: twoMiB, index })
    }
    await earlier.flush()
    await earlier.shutdown()
    posthog = undefined

    respond = () => ({ status: 200, body: { results: {} } })
    requests = []
    const next = await newPostHog()
    await next.flush()

    expect(requests.flatMap((request) => request.body.batch.map((event) => event.properties?.index))).toEqual([1, 2])
  })

  it('still persists smaller AI events when the newest is over 5 MiB', async () => {
    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    const earlier = await newPostHog({ flushAt: 10 })
    const warn = vi.spyOn((earlier as any)._logger, 'warn').mockImplementation(() => {})
    earlier.captureAi('$ai_generation', { index: 0 })
    earlier.captureAi('$ai_generation', { blob: 'x'.repeat(6 * 1024 * 1024), index: 1 })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('on-device limit'))
    await earlier.flush()
    await earlier.shutdown()
    posthog = undefined

    respond = () => ({ status: 200, body: { results: {} } })
    requests = []
    const next = await newPostHog()
    await next.flush()

    expect(requests.flatMap((request) => request.body.batch.map((event) => event.properties?.index))).toEqual([0])
  })

  it('keeps AI events from an earlier launch when flush() runs before storage has loaded', async () => {
    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    const earlier = await newPostHog()
    earlier.captureAi('$ai_generation')
    await earlier.shutdown()
    posthog = undefined

    respond = () => ({ status: 200, body: { results: {} } })
    requests = []
    posthog = new PostHog('test-token', {
      customStorage: {
        ...storage,
        getItem: (key) => new Promise((resolve) => setTimeout(() => resolve(cache[key] ?? null), 50)),
      },
      flushInterval: 0,
      preloadFeatureFlags: false,
      captureAppLifecycleEvents: false,
      captureAiCompression: 'none',
      disableCompression: true,
    })
    const early = posthog.flush()
    await posthog.ready()
    await early
    await posthog.flush()

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

    const disabled = await newPostHog({ disabled: true, flushInterval: 20 })
    await disabled.flush()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(sent(AI_PATH)).toEqual([])
  })

  const newPostHogWithSlowStorage = (options: PostHogOptions = {}): PostHog => {
    posthog = new PostHog('test-token', {
      customStorage: {
        ...storage,
        getItem: (key) => new Promise((resolve) => setTimeout(() => resolve(cache[key] ?? null), 50)),
      },
      flushInterval: 0,
      preloadFeatureFlags: false,
      captureAppLifecycleEvents: false,
      captureAiCompression: 'none',
      disableCompression: true,
      ...options,
    })
    return posthog
  }

  it('sends an AI event captured before initialization when flush() is called before ready()', async () => {
    const client = newPostHogWithSlowStorage()

    client.captureAi('$ai_generation')
    await client.flush()

    expect(sent(AI_PATH)).toEqual([['$ai_generation']])
  })

  it('starts no more AI requests once the shutdown deadline passes', async () => {
    const logs = (['debug', 'info', 'log', 'warn', 'error'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {})
    )
    respond = async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
      return { status: 200, body: { results: {} } }
    }
    const client = await newPostHog({ flushAt: 10 })
    // Each event is over half the 5 MiB batch target, so they go in separate requests.
    const threeMiB = 'x'.repeat(3 * 1024 * 1024)

    try {
      client.captureAi('$ai_generation', { blob: threeMiB })
      client.captureAi('$ai_span', { blob: threeMiB })
      await client.shutdown(50)
      await new Promise((resolve) => setTimeout(resolve, 600))

      expect(sent(AI_PATH)).toEqual([['$ai_generation']])
    } finally {
      posthog = undefined
      logs.forEach((spy) => spy.mockRestore())
    }
  })

  it('returns the uuid of its own event when a capture listener calls captureAi()', async () => {
    const client = await newPostHog({ flushAt: 10 })
    client.on('capture', (event) => {
      if (event.event === '$ai_generation') {
        client.captureAi('$ai_span')
      }
    })

    const uuid = client.captureAi('$ai_generation')
    await client.flush()

    const generation = requests.flatMap((request) => request.body.batch).find((e) => e.event === '$ai_generation')
    expect(uuid).toBe(generation?.uuid)
  })

  it('keeps an AI event captured before a persisted opt-in has loaded', async () => {
    const earlier = await newPostHog({ defaultOptIn: false })
    earlier.optIn()
    await earlier.shutdown()
    posthog = undefined

    const client = newPostHogWithSlowStorage({ defaultOptIn: false })
    const uuid = client.captureAi('$ai_generation')
    await client.ready()
    await client.flush()

    expect(uuid).toEqual(expect.any(String))
    expect(sent(AI_PATH)).toEqual([['$ai_generation']])
  })

  it('activates a session replay event trigger only for an AI event the lane queued', async () => {
    const client = await newPostHog({ flushAt: 10, captureAiMaxEventBytes: 2000 })
    vi.spyOn((client as any)._logger, 'warn').mockImplementation(() => {})
    const trigger = vi.spyOn(client as any, '_maybeActivateEventTrigger')

    expect(client.captureAi('$ai_generation', { $ai_input: 'x'.repeat(2500) })).toBeUndefined()
    expect(trigger).not.toHaveBeenCalledWith('$ai_generation')

    client.captureAi('$ai_generation', { $ai_input: 'short' })
    expect(trigger).toHaveBeenCalledWith('$ai_generation')
  })

  it('logs only the name and uuid of an AI event in debug mode', async () => {
    const client = await newPostHog({ flushAt: 10 })
    const info = vi.spyOn((client as any)._logger, 'info').mockImplementation(() => {})
    client.debug()

    const uuid = client.captureAi('$ai_generation', { $ai_input: 'private prompt' })

    const logged = JSON.stringify(info.mock.calls)
    expect(logged).not.toContain('private prompt')
    expect(info).toHaveBeenCalledWith('capture', { event: '$ai_generation', uuid })
  })

  it('sends AI events captured before initialization when shutdown() is called before ready()', async () => {
    const client = newPostHogWithSlowStorage({ flushAt: 10 })

    client.captureAi('$ai_generation')
    client.captureTraceFeedback('trace-1', 'great answer')
    client.captureTraceMetric('trace-1', 'score', 1)
    await client.shutdown()
    posthog = undefined

    expect(sent(AI_PATH)).toEqual([['$ai_generation', '$ai_feedback', '$ai_metric']])
  })

  it('sends AI events from an earlier launch when shutdown() is called before ready()', async () => {
    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    const earlier = await newPostHog()
    earlier.captureAi('$ai_generation')
    await earlier.shutdown()
    posthog = undefined
    respond = () => ({ status: 200, body: { results: {} } })
    requests = []

    const client = newPostHogWithSlowStorage()
    await client.shutdown()
    posthog = undefined

    expect(sent(AI_PATH)).toEqual([['$ai_generation']])
  })

  it('returns undefined and stores nothing when captureAi() is called after shutdown()', async () => {
    const client = await newPostHog()
    const captured: unknown[] = []
    client.on('capture', (event) => captured.push(event))
    await client.shutdown()
    posthog = undefined

    expect(client.captureAi('$ai_generation')).toBeUndefined()
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(captured).toEqual([])
    expect(cache['.posthog-rn-ai-test-token.json']).toBeUndefined()
  })

  it('returns the uuid sent on the wire when before_send sets an uppercase uuid', async () => {
    const client = await newPostHog({
      flushAt: 10,
      before_send: (event) => (event ? { ...event, uuid: '0198C0DE-1234-7ABC-8DEF-0123456789AB' } : event),
    })

    const uuid = client.captureAi('$ai_generation')
    await client.flush()

    expect(uuid).toBe('0198c0de-1234-7abc-8def-0123456789ab')
    expect(requests[0].body.batch[0].uuid).toBe(uuid)
  })

  it('does not rewrite the stored AI queue when a send sends nothing', async () => {
    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    const setItem = vi.spyOn(storage, 'setItem')
    const client = await newPostHog({ flushAt: 10 })
    client.captureAi('$ai_generation')
    await client.flush()
    const writes = setItem.mock.calls.filter(([key]) => key === '.posthog-rn-ai-test-token.json').length

    await client.flush()
    await client.flush()

    expect(writes).toBeGreaterThan(0)
    expect(setItem.mock.calls.filter(([key]) => key === '.posthog-rn-ai-test-token.json').length).toBe(writes)
  })

  it('halves the AI batch on 413 and sends every event', async () => {
    respond = (request) =>
      request.path === AI_PATH && request.body.batch.length > 1
        ? { status: 413 }
        : { status: 200, body: { results: {} } }
    const client = await newPostHog({ flushAt: 10 })

    client.captureAi('$ai_generation', { index: 0 })
    client.captureAi('$ai_generation', { index: 1 })
    await client.flush()

    expect(requests.filter((r) => r.path === AI_PATH).map((r) => r.body.batch.length)).toEqual([2, 1, 1])
  })

  it('drops a single AI event the server rejects with 413', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    respond = (request) => (request.path === AI_PATH ? { status: 413 } : { status: 200, body: { results: {} } })
    const client = await newPostHog({ flushAt: 10 })

    client.captureAi('$ai_generation')
    await client.flush()
    await client.flush()

    expect(sent(AI_PATH)).toEqual([['$ai_generation']])
  })

  it('resends AI events after the resend wait', async () => {
    let failures = 1
    respond = (request) =>
      request.path === AI_PATH && failures-- > 0 ? { status: 503, body: {} } : { status: 200, body: { results: {} } }
    const client = await newPostHog({ flushAt: 1 })

    client.captureAi('$ai_generation')
    await new Promise((resolve) => setTimeout(resolve, 1800))

    expect(sent(AI_PATH)).toEqual([['$ai_generation'], ['$ai_generation']])
  })

  it('returns undefined for an AI event whose properties cannot be serialized', async () => {
    const client = await newPostHog({ flushAt: 10 })
    vi.spyOn((client as any)._logger, 'error').mockImplementation(() => {})

    const uuid = client.captureAi('$ai_generation', {
      bad: {
        toJSON: () => {
          throw new Error('boom')
        },
      },
    })
    await client.flush()

    expect(uuid).toBeUndefined()
    expect(sent(AI_PATH)).toEqual([])
  })
})
