import { PostHog } from '@/entrypoints/index.node'

vi.mock('../version', () => ({ version: '1.2.3' }))

describe('immediate delivery errors', () => {
  let posthog: PostHog
  const fetch = vi.spyOn(globalThis, 'fetch')

  beforeEach(() => {
    fetch.mockReset().mockResolvedValue(new Response(null, { status: 200 }))
    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      flushInterval: 0,
      fetchRetryCount: 0,
      requestTimeout: 100,
      disableCompression: true,
    })
  })

  afterEach(async () => {
    fetch.mockResolvedValue(new Response(null, { status: 200 }))
    await posthog.shutdown()
  })

  afterAll(() => fetch.mockRestore())

  it.each([
    ['captureImmediate', (client: PostHog) => client.captureImmediate({ distinctId: '123', event: 'test-event' })],
    ['identifyImmediate', (client: PostHog) => client.identifyImmediate({ distinctId: '123' })],
    ['aliasImmediate', (client: PostHog) => client.aliasImmediate({ distinctId: '123', alias: '456' })],
    [
      'groupIdentifyImmediate',
      (client: PostHog) => client.groupIdentifyImmediate({ groupType: 'team', groupKey: '456' }),
    ],
    [
      'captureExceptionImmediate',
      (client: PostHog) => client.captureExceptionImmediate(new Error('test exception'), '123'),
    ],
    [
      'captureAiImmediate',
      (client: PostHog) => client.captureAiImmediate({ distinctId: '123', event: '$ai_generation' }),
    ],
  ] as const)('%s rejects failed delivery and still emits the error', async (_, capture) => {
    const onError = vi.fn()
    posthog.on('error', onError)
    fetch.mockResolvedValue(new Response(null, { status: 503 }))

    const delivery = capture(posthog)

    await expect(delivery).rejects.toThrow('HTTP error while fetching PostHog: status=503')
    expect(onError).toHaveBeenCalledTimes(1)
    await expect(delivery).rejects.toBe(onError.mock.calls[0][0])
  })

  it.each([300, 302, 304, 400, 429, 503])('rejects a terminal HTTP %i response', async (status) => {
    fetch.mockResolvedValue(new Response(null, { status }))

    await expect(posthog.captureImmediate({ distinctId: '123', event: 'test-event' })).rejects.toThrow(
      `HTTP error while fetching PostHog: status=${status}`
    )
  })

  it('rejects network errors', async () => {
    fetch.mockRejectedValue(new Error('connection failed'))

    await expect(posthog.captureImmediate({ distinctId: '123', event: 'test-event' })).rejects.toThrow(
      'Network error while fetching PostHog'
    )
  })

  it('rejects when an injected fetch never settles', async () => {
    fetch.mockImplementation(() => new Promise(() => {}))
    const delivery = posthog.captureImmediate({ distinctId: '123', event: 'test-event' })
    void delivery.catch(() => {})

    await vi.advanceTimersByTimeAsync(100)
    await expect(delivery).rejects.toThrow('Network error while fetching PostHog')
  })

  it('resolves after a successful retry', async () => {
    const client = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      flushInterval: 0,
      fetchRetryCount: 1,
      fetchRetryDelay: 10,
      disableCompression: true,
    })
    fetch.mockResolvedValueOnce(new Response(null, { status: 503 }))
    const delivery = client.captureImmediate({ distinctId: '123', event: 'test-event' })

    await vi.advanceTimersByTimeAsync(10)

    await expect(delivery).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(2)
    await client.shutdown()
  })

  it('rejects after exhausting retries and emits only the terminal error', async () => {
    const client = new PostHog('TEST_API_KEY', {
      flushInterval: 0,
      fetchRetryCount: 1,
      fetchRetryDelay: 10,
      disableCompression: true,
    })
    const onError = vi.fn()
    client.on('error', onError)
    fetch.mockResolvedValue(new Response(null, { status: 503 }))
    const delivery = client.captureImmediate({ distinctId: '123', event: 'test-event' })
    void delivery.catch(() => {})

    await vi.advanceTimersByTimeAsync(10)

    await expect(delivery).rejects.toThrow('HTTP error while fetching PostHog: status=503')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledTimes(1)
    await client.shutdown()
  })

  it('allows flush and shutdown to finish while an immediate delivery fails', async () => {
    fetch.mockImplementation(() => new Promise(() => {}))
    const delivery = posthog.captureImmediate({ distinctId: '123', event: 'test-event' })
    void delivery.catch(() => {})
    const flushing = posthog.flush()
    const shutdown = posthog.shutdown()

    await vi.advanceTimersByTimeAsync(100)

    await expect(delivery).rejects.toThrow('Network error while fetching PostHog')
    await expect(flushing).resolves.toBeUndefined()
    await expect(shutdown).resolves.toBeUndefined()
  })

  it('drains queued events during shutdown when a pending immediate delivery fails', async () => {
    fetch.mockImplementationOnce(() => new Promise(() => {}))
    const delivery = posthog.captureImmediate({ distinctId: '123', event: 'immediate-event' })
    void delivery.catch(() => {})
    posthog.capture({ distinctId: '123', event: 'queued-event' })
    await vi.advanceTimersByTimeAsync(0)

    const shutdown = posthog.shutdown()
    await vi.advanceTimersByTimeAsync(100)

    await expect(delivery).rejects.toThrow('Network error while fetching PostHog')
    await expect(shutdown).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetch.mock.calls[1][1]?.body as string).batch).toMatchObject([{ event: 'queued-event' }])
  })

  it('waits for remaining immediate requests before draining after a delivery failure', async () => {
    let failRequest!: (response: Response) => void
    let completeRequest!: (response: Response) => void
    let onFirstRequest!: () => void
    let onSecondRequest!: () => void
    const firstRequestStarted = new Promise<void>((resolve) => {
      onFirstRequest = resolve
    })
    const secondRequestStarted = new Promise<void>((resolve) => {
      onSecondRequest = resolve
    })
    const firstResponse = new Promise<Response>((resolve) => {
      failRequest = resolve
    })
    const secondResponse = new Promise<Response>((resolve) => {
      completeRequest = resolve
    })
    fetch
      .mockImplementationOnce(() => {
        onFirstRequest()
        return firstResponse
      })
      .mockImplementationOnce(() => {
        onSecondRequest()
        return secondResponse
      })
    const failing = posthog.captureImmediate({ distinctId: '123', event: 'failing-event' })
    void failing.catch(() => {})
    await firstRequestStarted
    const succeeding = posthog.captureExceptionImmediate(new Error('test exception'), '123')
    posthog.capture({ distinctId: '123', event: 'queued-event' })
    let shutdown: Promise<void> | undefined

    try {
      await secondRequestStarted
      const onShutdown = vi.fn()
      shutdown = posthog.shutdown().then(onShutdown)
      await vi.advanceTimersByTimeAsync(0)
      failRequest(new Response(null, { status: 503 }))
      await vi.advanceTimersByTimeAsync(0)

      await expect(failing).rejects.toThrow('HTTP error while fetching PostHog: status=503')
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(onShutdown).not.toHaveBeenCalled()

      completeRequest(new Response(null, { status: 200 }))
      await vi.advanceTimersByTimeAsync(0)

      await expect(succeeding).resolves.toBeUndefined()
      await shutdown
      expect(onShutdown).toHaveBeenCalledTimes(1)
      expect(fetch).toHaveBeenCalledTimes(3)
      expect(JSON.parse(fetch.mock.calls[2][1]?.body as string).batch).toMatchObject([{ event: 'queued-event' }])
    } finally {
      failRequest(new Response(null, { status: 503 }))
      completeRequest(new Response(null, { status: 200 }))
      await Promise.allSettled([failing, succeeding, shutdown])
    }
  })

  it.each([
    ['captureImmediate', (client: PostHog) => client.captureImmediate({ distinctId: '123', event: 'test-event' })],
    [
      'captureExceptionImmediate',
      (client: PostHog) => client.captureExceptionImmediate(new Error('test exception'), '123'),
    ],
    [
      'captureAiImmediate',
      (client: PostHog) => client.captureAiImmediate({ distinctId: '123', event: '$ai_generation' }),
    ],
  ] as const)('%s still resolves when before_send drops the event', async (_, capture) => {
    const client = new PostHog('TEST_API_KEY', { before_send: () => null, flushInterval: 0 })
    const onError = vi.fn()
    client.on('error', onError)

    await capture(client)

    expect(fetch).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    await client.shutdown()
  })

  it('keeps background capture failures out of the calling application', async () => {
    const onError = vi.fn()
    fetch.mockResolvedValue(new Response(null, { status: 503 }))

    const client = new PostHog('TEST_API_KEY', {
      flushAt: 1,
      flushInterval: 0,
      fetchRetryCount: 0,
      disableCompression: true,
    })
    client.on('error', onError)

    expect(client.capture({ distinctId: '123', event: 'test-event' })).toBeUndefined()
    await vi.advanceTimersByTimeAsync(0)

    expect(onError).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(1)
    await client.shutdown()
  })
})
