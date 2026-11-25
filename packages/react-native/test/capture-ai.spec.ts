// The default storage on iOS and Android: Expo's file system, backed here by `expoFiles.files`, keyed by directory + name.
const { expoFiles } = vi.hoisted(() => ({
  expoFiles: {
    files: {} as Record<string, string>,
    readDelayMs: 0,
    failingReads: new Set<string>(),
    read: vi.fn(),
    write: vi.fn(),
    remove: vi.fn(),
  },
}))

vi.mock('../src/optional/OptionalExpoFileSystem', () => ({
  OptionalExpoFileSystem: {
    Paths: {
      document: { uri: '' },
      cache: {
        uri: 'cache/',
        list: () =>
          Object.keys(expoFiles.files)
            .filter((path) => path.startsWith('cache/'))
            .map((path) => ({ name: path.slice('cache/'.length) })),
      },
    },
    File: class {
      private readonly path: string
      constructor(directory: { uri: string }, name: string) {
        this.path = directory.uri + name
      }
      async text(): Promise<string> {
        if (expoFiles.readDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, expoFiles.readDelayMs))
        }
        expoFiles.read(this.path)
        const content = expoFiles.files[this.path]
        if (content === undefined || expoFiles.failingReads.has(this.path)) {
          throw new Error('missing file')
        }
        return content
      }
      async write(content: string): Promise<void> {
        expoFiles.write(this.path, content)
        expoFiles.files[this.path] = content
      }
      get exists(): boolean {
        return this.path in expoFiles.files
      }
      delete(): void {
        expoFiles.remove(this.path)
        delete expoFiles.files[this.path]
      }
    },
  },
}))
vi.mock('../src/optional/OptionalExpoFileSystemLegacy', () => ({ OptionalExpoFileSystemLegacy: undefined }))
vi.mock('../src/optional/OptionalAsyncStorage', () => ({ OptionalAsyncStorage: undefined }))

import { PostHog, PostHogCustomStorage, PostHogOptions } from '../src'

const AI_INDEX = 'cache/.posthog-rn-ai-test-token.json'
const aiFile = (file: number): string => `cache/.posthog-rn-ai-test-token.event-${file}`

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
  type CaptureResponse = { status: number; body?: unknown; headers?: Record<string, string> }
  let respond: (request: CaptureRequest) => CaptureResponse | Promise<CaptureResponse>
  let posthog: PostHog | undefined
  let cache: Record<string, string>

  beforeAll(() => {
    vi.useRealTimers()
  })

  afterAll(() => {
    ;(globalThis as any).window.fetch = originalFetch
    vi.useFakeTimers()
  })

  beforeEach(() => {
    requests = []
    cache = expoFiles.files = {}
    expoFiles.readDelayMs = 0
    expoFiles.failingReads.clear()
    expoFiles.read.mockClear()
    expoFiles.write.mockClear()
    expoFiles.remove.mockClear()
    respond = () => ({ status: 200, body: { results: {} } })
    ;(globalThis as any).window.fetch = vi.fn(async (url: string, options: any) => {
      const path = new URL(String(url)).pathname
      if (path !== AI_PATH && path !== ANALYTICS_PATH) {
        return { status: 200, json: async () => ({}), text: async () => '{}' }
      }
      const request = { path, headers: options.headers, body: JSON.parse(options.body) }
      requests.push(request)
      const { status, body, headers } = await respond(request)
      return {
        status,
        headers: { get: (name: string) => headers?.[name.toLowerCase()] ?? null },
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

  it('indexes kept AI events by uuid, sizes and file, with each event in its own file', async () => {
    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    const client = await newPostHog()
    const uuid = client.captureAi('$ai_generation')
    await client.flush()
    await client.shutdown()
    posthog = undefined

    const [stored] = JSON.parse(cache[AI_INDEX]).content.ai_queue
    expect(Object.keys(stored).sort()).toEqual(['bytes', 'file', 'propertiesBytes', 'uuid'])
    expect(JSON.parse(cache[aiFile(stored.file)]).uuid).toBe(uuid)
  })

  it('writes each AI event to its own file once and deletes the file once it is sent', async () => {
    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    const client = await newPostHog({ flushAt: 10 })
    client.captureAi('$ai_generation', { index: 0 })
    client.captureAi('$ai_generation', { index: 1 })
    await client.flush()
    endResendWait(client)
    await client.flush()
    const fileWrites = (): string[] =>
      expoFiles.write.mock.calls.map(([key]) => key).filter((key: string) => key.includes('.event-'))

    expect(fileWrites()).toEqual([aiFile(0), aiFile(1)])
    expect(expoFiles.remove).not.toHaveBeenCalled()

    respond = () => ({ status: 200, body: { results: {} } })
    endResendWait(client)
    await client.flush()

    expect(fileWrites()).toEqual([aiFile(0), aiFile(1)])
    expect(expoFiles.remove.mock.calls.map(([key]) => key)).toEqual([aiFile(0), aiFile(1)])
    expect(Object.keys(cache).filter((key) => key.includes('.event-'))).toEqual([])
    expect(JSON.parse(cache[AI_INDEX]).content.ai_queue).toBeUndefined()
  })

  it('never writes a new AI event to the file of a sent one that a stale stored index still lists', async () => {
    let aiResponses: number[] = [503]
    respond = (request) =>
      request.path === AI_PATH
        ? { status: aiResponses.length > 1 ? aiResponses.shift()! : aiResponses[0] }
        : { status: 200, body: { results: {} } }
    const client = await newPostHog({ flushAt: 1, maxBatchSize: 1 })
    client.captureAi('$ai_generation', { index: 0 })
    client.captureAi('$ai_generation', { index: 1 })
    await client.flush()
    await (client as any)._aiLane.waitForPersist()
    // The index as it was before event 0 was sent, as if the app were killed before the newer one landed.
    const staleIndex = cache[AI_INDEX]

    aiResponses = [200, 503]
    endResendWait(client)
    await client.flush()
    client.captureAi('$ai_generation', { index: 2 })
    await (client as any)._aiLane.waitForPersist()

    expect(cache[aiFile(0)]).toBeUndefined()
    expect(expoFiles.write.mock.calls.filter(([key]) => key === aiFile(0))).toHaveLength(1)

    vi.spyOn((client as any)._logger, 'critical').mockImplementation(() => {})
    await client.shutdown(50)
    posthog = undefined
    cache[AI_INDEX] = staleIndex

    respond = () => ({ status: 200, body: { results: {} } })
    requests = []
    const next = await newPostHog()
    await next.flush()

    expect(requests.flatMap((request) => request.body.batch.map((event) => event.properties?.index))).toEqual([1])
  })

  it('keeps stored AI event files when the stored index cannot be read at launch', async () => {
    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    const earlier = await newPostHog({ flushAt: 10 })
    earlier.captureAi('$ai_generation', { index: 0 })
    earlier.captureAi('$ai_generation', { index: 1 })
    await earlier.flush()
    await earlier.shutdown()
    posthog = undefined

    expoFiles.failingReads.add(AI_INDEX)
    const unreadable = await newPostHog({ flushAt: 10 })
    await (unreadable as any)._aiLane.waitForPersist()
    await unreadable.shutdown()
    posthog = undefined
    expect(expoFiles.remove).not.toHaveBeenCalled()

    expoFiles.failingReads.clear()
    respond = () => ({ status: 200, body: { results: {} } })
    requests = []
    const next = await newPostHog()
    await next.flush()
    expect(requests.flatMap((request) => request.body.batch.map((event) => event.properties?.index))).toEqual([0, 1])
  })

  it("deletes this project's AI event files that the stored index does not list at launch", async () => {
    cache[AI_INDEX] = JSON.stringify({ version: 'v1', content: {} })
    cache[aiFile(7)] = '{"orphan":true}'
    cache['cache/.posthog-rn-ai-other-token.event-3'] = '{}'
    cache['cache/app-file'] = 'kept'

    const client = await newPostHog({ flushAt: 10 })
    await (client as any)._aiLane.waitForPersist()

    expect(cache[aiFile(7)]).toBeUndefined()
    expect(cache['cache/.posthog-rn-ai-other-token.event-3']).toBe('{}')
    expect(cache['cache/app-file']).toBe('kept')

    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    client.captureAi('$ai_generation')
    await (client as any)._aiLane.waitForPersist()
    expect(JSON.parse(cache[AI_INDEX]).content.ai_queue.map((stored: { file: number }) => stored.file)).toEqual([8])
  })

  it('drops a stored AI event cut off mid-write and sends the rest', async () => {
    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    const earlier = await newPostHog({ flushAt: 10 })
    earlier.captureAi('$ai_generation', { index: 0 })
    earlier.captureAi('$ai_generation', { index: 1 })
    await earlier.flush()
    await earlier.shutdown()
    posthog = undefined
    cache[aiFile(0)] = cache[aiFile(0)].slice(0, -5)

    respond = () => ({ status: 200, body: { results: {} } })
    requests = []
    const next = await newPostHog()
    await next.flush()

    expect(requests.flatMap((request) => request.body.batch.map((event) => event.properties?.index))).toEqual([1])
    expect(JSON.parse(cache[AI_INDEX]).content.ai_queue).toBeUndefined()
  })

  it('removes an unreadable stored AI event from disk before flush() resolves', async () => {
    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    const earlier = await newPostHog({ flushAt: 10 })
    earlier.captureAi('$ai_generation', { index: 0 })
    await earlier.flush()
    await earlier.shutdown()
    posthog = undefined
    cache[aiFile(0)] = cache[aiFile(0)].slice(0, -5)

    respond = () => ({ status: 200, body: { results: {} } })
    requests = []
    const next = await newPostHog()
    await next.flush()

    expect(sent(AI_PATH)).toEqual([])
    expect(JSON.parse(cache[AI_INDEX]).content.ai_queue).toBeUndefined()
  })

  it('sends no AI events once shutdown() times out while stored events are being read', async () => {
    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    const earlier = await newPostHog({ flushAt: 10 })
    earlier.captureAi('$ai_generation', { index: 0 })
    await earlier.flush()
    await earlier.shutdown()
    posthog = undefined

    respond = () => ({ status: 200, body: { results: {} } })
    requests = []
    const next = await newPostHog({ flushAt: 10 })
    vi.spyOn((next as any)._logger, 'critical').mockImplementation(() => {})
    expoFiles.readDelayMs = 120
    await next.shutdown(30)
    posthog = undefined
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(sent(AI_PATH)).toEqual([])
    expect(JSON.parse(cache[AI_INDEX]).content.ai_queue).toHaveLength(1)
  })

  it('lets go of an evicted AI event before its file write finishes', async () => {
    const client = await newPostHog({ flushAt: 100, captureAiMaxQueueSize: 1 })
    client.captureAi('$ai_generation', { index: 0 })
    const evicted = (client as any)._aiLane._events[0]
    expect(evicted.json).toBeDefined()

    client.captureAi('$ai_generation', { index: 1 })

    expect(evicted.json).toBeUndefined()
  })

  it('reads stored AI events from their files only when sending them', async () => {
    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    const earlier = await newPostHog({ flushAt: 10 })
    earlier.captureAi('$ai_generation', { index: 0 })
    await earlier.flush()
    endResendWait(earlier)
    await earlier.flush()
    expect(expoFiles.read.mock.calls.filter(([path]) => path === aiFile(0))).toHaveLength(1)
    await earlier.shutdown()
    posthog = undefined

    expoFiles.read.mockClear()
    respond = () => ({ status: 200, body: { results: {} } })
    requests = []
    const next = await newPostHog()
    expect(expoFiles.read.mock.calls.filter(([path]) => path.includes('.event-'))).toEqual([])
    await next.flush()

    expect(expoFiles.read.mock.calls.map(([path]) => path).filter((path) => path.includes('.event-'))).toEqual([
      aiFile(0),
    ])
    expect(sent(AI_PATH)).toEqual([['$ai_generation']])
  })

  it('writes no file for an AI event evicted before its write starts', async () => {
    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    const client = await newPostHog({ flushAt: 100, captureAiMaxQueueSize: 2 })
    for (let index = 0; index < 20; index++) {
      client.captureAi('$ai_generation', { index })
    }
    await (client as any)._aiLane.waitForPersist()

    expect(expoFiles.write.mock.calls.map(([key]) => key).filter((key: string) => key.includes('.event-'))).toEqual([
      aiFile(18),
      aiFile(19),
    ])
    expect(expoFiles.remove).not.toHaveBeenCalled()
    expect([18, 19].map((file) => JSON.parse(cache[aiFile(file)]).properties.index)).toEqual([18, 19])
  })

  it('leaves AI events stored by an earlier launch untouched when the SDK is disabled', async () => {
    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    const earlier = await newPostHog({ flushAt: 10 })
    earlier.captureAi('$ai_generation', { index: 0 })
    earlier.captureAi('$ai_generation', { index: 1 })
    await earlier.flush()
    await earlier.shutdown()
    posthog = undefined
    expoFiles.read.mockClear()
    expoFiles.write.mockClear()

    const errors: unknown[] = []
    const disabled = await newPostHog({ disabled: true, captureAiMaxQueueSize: 1 })
    disabled.on('error', (error) => errors.push(error))
    await new Promise((resolve) => setTimeout(resolve, 150))
    await disabled.shutdown()
    posthog = undefined

    expect(expoFiles.read.mock.calls.filter(([path]) => path.includes('-ai-'))).toEqual([])
    expect(expoFiles.write.mock.calls.filter(([path]) => path.includes('-ai-'))).toEqual([])
    expect(expoFiles.remove).not.toHaveBeenCalled()
    expect(errors).toEqual([])

    respond = () => ({ status: 200, body: { results: {} } })
    requests = []
    const next = await newPostHog()
    await next.flush()
    expect(requests.flatMap((request) => request.body.batch.map((event) => event.properties?.index))).toEqual([0, 1])
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
      flushInterval: 0,
      preloadFeatureFlags: false,
      captureAppLifecycleEvents: false,
      captureAiCompression: 'none',
    })
    await posthog.ready()
    await posthog.flush()

    expect(sent(AI_PATH)).toEqual([])
    expect(JSON.parse(cache[AI_INDEX]).content.ai_queue).toHaveLength(1)
  })

  it('keeps every queued AI event for the next launch, including one over 5 MiB', async () => {
    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    const earlier = await newPostHog({ flushAt: 10 })
    earlier.captureAi('$ai_generation', { blob: 'x'.repeat(3 * 1024 * 1024), index: 0 })
    earlier.captureAi('$ai_generation', { blob: 'x'.repeat(6 * 1024 * 1024), index: 1 })
    earlier.captureAi('$ai_generation', { index: 2 })
    await earlier.flush()
    await earlier.shutdown()
    posthog = undefined

    respond = () => ({ status: 200, body: { results: {} } })
    requests = []
    const next = await newPostHog()
    await next.flush()

    expect(requests.flatMap((request) => request.body.batch.map((event) => event.properties?.index))).toEqual([0, 1, 2])
  })

  it('keeps the AI queue in memory, out of both stores, when customStorage is set', async () => {
    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    const custom: Record<string, string> = {}
    const customStorage: PostHogCustomStorage = {
      getItem: async (key) => custom[key] ?? null,
      setItem: async (key, value) => {
        custom[key] = value
      },
    }
    const client = await newPostHog({ customStorage })
    client.captureAi('$ai_generation')
    await client.flush()
    await client.shutdown()
    posthog = undefined

    expect(Object.keys(custom).filter((key) => key.includes('-ai-'))).toEqual([])
    expect(Object.keys(cache).filter((key) => key.startsWith('cache/'))).toEqual([])
  })

  it('keeps AI events from an earlier launch when flush() runs before storage has loaded', async () => {
    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    const earlier = await newPostHog()
    earlier.captureAi('$ai_generation')
    await earlier.shutdown()
    posthog = undefined

    respond = () => ({ status: 200, body: { results: {} } })
    requests = []
    expoFiles.readDelayMs = 50
    posthog = new PostHog('test-token', {
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
    expoFiles.readDelayMs = 50
    posthog = new PostHog('test-token', {
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
    expect(cache[AI_INDEX]).toBeUndefined()
  })

  it('returns the uuid sent on the wire when before_send sets an uppercase uuid', async () => {
    const client = await newPostHog({
      flushAt: 10,
      before_send: (event) => (event ? { ...event, uuid: '0198C0DE-1234-7ABC-8DEF-0123456789AB' } : event),
    })

    const captured: { uuid?: string }[] = []
    client.on('capture', (event) => captured.push(event))

    const uuid = client.captureAi('$ai_generation')
    await client.flush()

    expect(uuid).toBe('0198c0de-1234-7abc-8def-0123456789ab')
    expect(requests[0].body.batch[0].uuid).toBe(uuid)
    expect(captured.map((event) => event.uuid)).toEqual([uuid])
  })

  it('does not rewrite the stored AI queue when a send sends nothing', async () => {
    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    const client = await newPostHog({ flushAt: 10 })
    client.captureAi('$ai_generation')
    await client.flush()
    const writes = expoFiles.write.mock.calls.filter(([key]) => key === AI_INDEX).length

    ;(client as any)._aiLane._resendAt = 0
    await client.flush()
    ;(client as any)._aiLane._resendAt = 0
    await client.flush()

    expect(sent(AI_PATH)).toHaveLength(3)
    expect(writes).toBeGreaterThan(0)
    expect(expoFiles.write.mock.calls.filter(([key]) => key === AI_INDEX).length).toBe(writes)
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

  const identity = (request: CaptureRequest): unknown => ({
    requestId: request.headers['PostHog-Request-Id'],
    createdAt: (request.body as any).created_at,
  })
  const endResendWait = (client: PostHog): void => {
    ;(client as any)._aiLane._resendAt = 0
  }

  it('resends only the deferred AI events as a retry of their request', async () => {
    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    const client = await newPostHog({ flushAt: 10 })
    client.captureAi('$ai_generation', { index: 0 })
    await client.flush()
    client.captureAi('$ai_generation', { index: 1 })

    respond = () => ({ status: 200, body: { results: {} } })
    endResendWait(client)
    await client.flush()

    const ai = requests.filter((request) => request.path === AI_PATH)
    expect(ai.map((request) => request.body.batch.map((event) => event.properties?.index))).toEqual([[0], [0], [1]])
    expect(identity(ai[1])).toEqual(identity(ai[0]))
    expect(ai[1].headers['PostHog-Attempt']).toBe('2')
    expect(identity(ai[2])).not.toEqual(identity(ai[0]))
    expect(ai[2].headers['PostHog-Attempt']).toBe('1')
  })

  it('resends AI events the server asked to retry as a retry of their request', async () => {
    let attempt = 0
    respond = (request) =>
      request.path === AI_PATH && ++attempt === 1
        ? {
            status: 200,
            body: {
              results: {
                [request.body.batch[0].uuid]: { result: 'ok' },
                [request.body.batch[1].uuid]: { result: 'retry', details: 'not_persisted' },
              },
            },
          }
        : { status: 200, body: { results: {} } }
    const client = await newPostHog({ flushAt: 10 })
    client.captureAi('$ai_generation', { index: 0 })
    client.captureAi('$ai_generation', { index: 1 })
    await client.flush()
    client.captureAi('$ai_generation', { index: 2 })

    endResendWait(client)
    await client.flush()

    const ai = requests.filter((request) => request.path === AI_PATH)
    expect(ai.map((request) => request.body.batch.map((event) => event.properties?.index))).toEqual([[0, 1], [1], [2]])
    expect(identity(ai[1])).toEqual(identity(ai[0]))
    expect(ai[1].headers['PostHog-Attempt']).toBe('2')
  })

  it('holds flush() and a short shutdown() during the AI resend wait', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(1)
    respond = (request) => (request.path === AI_PATH ? { status: 503 } : { status: 200, body: { results: {} } })
    const client = await newPostHog({ flushAt: 10 })
    client.captureAi('$ai_generation')
    await client.flush()

    await client.flush()
    await client.shutdown(100)
    posthog = undefined
    randomSpy.mockRestore()

    expect(sent(AI_PATH)).toEqual([['$ai_generation']])
  })

  it('waits out the AI resend wait in shutdown() when it fits', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    let failures = 1
    respond = (request) =>
      request.path === AI_PATH && failures-- > 0 ? { status: 503 } : { status: 200, body: { results: {} } }
    const client = await newPostHog({ flushAt: 10 })
    client.captureAi('$ai_generation')
    await client.flush()

    await client.shutdown(5000)
    posthog = undefined
    randomSpy.mockRestore()

    expect(sent(AI_PATH)).toEqual([['$ai_generation'], ['$ai_generation']])
  })

  it('does not flush newer AI events on a stale resend timer after a send succeeds', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    let failures = 1
    respond = (request) =>
      request.path === AI_PATH && failures-- > 0 ? { status: 503 } : { status: 200, body: { results: {} } }
    const client = await newPostHog({ flushAt: 10 })
    client.captureAi('$ai_generation', { index: 0 })
    await client.flush()
    endResendWait(client)
    await client.flush()

    client.captureAi('$ai_generation', { index: 1 })
    await new Promise((resolve) => setTimeout(resolve, 1000))
    randomSpy.mockRestore()

    expect(requests.map((request) => request.body.batch.map((event) => event.properties?.index))).toEqual([[0], [0]])
  })

  it('reports an AI request still running when shutdown times out', async () => {
    respond = (request) => (request.path === AI_PATH ? new Promise(() => {}) : { status: 200, body: { results: {} } })
    const client = await newPostHog({ flushAt: 10 })
    const critical = vi.spyOn((client as any)._logger, 'critical').mockImplementation(() => {})

    client.captureAi('$ai_generation')
    await client.shutdown(100)
    posthog = undefined

    expect(critical).toHaveBeenCalledTimes(1)
    expect(critical).toHaveBeenCalledWith(expect.stringContaining('AI events'), { shutdownTimeoutMs: 100 })
  })

  it('keeps a fresh Retry-After from a resend that shutdown() waited for', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    let attempt = 0
    respond = (request) => {
      if (request.path !== AI_PATH) {
        return { status: 200, body: { results: {} } }
      }
      return ++attempt === 1 ? { status: 503 } : { status: 429, headers: { 'retry-after': '30' } }
    }
    const client = await newPostHog({ flushAt: 10 })
    client.captureAi('$ai_generation')
    await client.flush()

    await client.shutdown(5000)
    posthog = undefined
    randomSpy.mockRestore()

    const ai = requests.filter((request) => request.path === AI_PATH)
    expect(ai.map((request) => request.headers['PostHog-Attempt'])).toEqual(['1', '2'])
  })

  it('waits out the resend wait of an AI request in flight when shutdown() starts', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    let failures = 1
    respond = async (request) => {
      if (request.path === AI_PATH && failures-- > 0) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return { status: 503 }
      }
      return { status: 200, body: { results: {} } }
    }
    const client = await newPostHog({ flushAt: 1 })
    client.captureAi('$ai_generation')

    await client.shutdown(5000)
    posthog = undefined
    randomSpy.mockRestore()

    expect(sent(AI_PATH)).toEqual([['$ai_generation'], ['$ai_generation']])
  })

  it('resends AI events the server asked to retry during shutdown()', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    let attempt = 0
    respond = (request) =>
      request.path === AI_PATH && ++attempt === 1
        ? {
            status: 200,
            body: {
              results: {
                [request.body.batch[0].uuid]: { result: 'ok' },
                [request.body.batch[1].uuid]: { result: 'retry', details: 'not_persisted' },
              },
            },
          }
        : { status: 200, body: { results: {} } }
    const client = await newPostHog({ flushAt: 10 })
    client.captureAi('$ai_generation')
    client.captureAi('$ai_span')

    await client.shutdown(6000)
    posthog = undefined
    randomSpy.mockRestore()

    expect(sent(AI_PATH)).toEqual([['$ai_generation', '$ai_span'], ['$ai_span']])
  })

  describe('with storage slower than the shutdown timeout', () => {
    const slowClient = (): { client: PostHog; critical: ReturnType<typeof vi.spyOn> } => {
      expoFiles.readDelayMs = 60
      const client = new PostHog('test-token', {
        flushInterval: 0,
        flushAt: 10,
        preloadFeatureFlags: false,
        captureAppLifecycleEvents: false,
        captureAiCompression: 'none',
        disableCompression: true,
      })
      return { client, critical: vi.spyOn((client as any)._logger, 'critical').mockImplementation(() => {}) }
    }

    it('reports no AI timeout when no AI event was captured', async () => {
      const { client, critical } = slowClient()

      await client.shutdown(20)

      expect(critical).not.toHaveBeenCalledWith(expect.stringContaining('AI events'), expect.anything())
    })

    it('starts no AI request once the shutdown time is used up waiting for initialization', async () => {
      const { client } = slowClient()
      client.captureAi('$ai_generation')

      await client.shutdown(20)
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(sent(AI_PATH)).toEqual([])
    })
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
