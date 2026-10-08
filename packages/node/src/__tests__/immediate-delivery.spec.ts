import { PostHog } from '@/entrypoints/index.node'

vi.mock('../version', () => ({ version: '1.2.3' }))

describe('immediate write responses', () => {
  let posthog: PostHog
  const fetch = vi.spyOn(globalThis, 'fetch')

  beforeEach(() => {
    fetch.mockReset().mockResolvedValue(new Response(null, { status: 200 }))
    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      flushInterval: 0,
      fetchRetryCount: 0,
      requestTimeout: 10000,
      disableCompression: true,
    })
  })

  afterEach(async () => {
    fetch.mockResolvedValue(new Response(null, { status: 200 }))
    await posthog.shutdown()
  })

  afterAll(() => fetch.mockRestore())

  it.each([300, 302, 304, 503])('emits HTTP %i errors without rejecting immediate calls', async (status) => {
    const onError = vi.fn()
    posthog.on('error', onError)
    fetch.mockResolvedValue(new Response(null, { status }))

    await expect(posthog.captureImmediate({ distinctId: '123', event: 'test-event' })).resolves.toBeUndefined()

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toMatchObject({ name: 'PostHogFetchHttpError', status })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([200, 204])('accepts HTTP %i without emitting an error', async (status) => {
    const onError = vi.fn()
    posthog.on('error', onError)
    fetch.mockResolvedValue(new Response(null, { status }))

    await expect(posthog.captureImmediate({ distinctId: '123', event: 'test-event' })).resolves.toBeUndefined()

    expect(onError).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('drains queued events within the shutdown budget when an immediate error body stalls', async () => {
    let respond!: (response: Response) => void
    fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve
        })
    )
    const delivery = posthog.captureImmediate({ distinctId: '123', event: 'immediate-event' })
    void delivery.catch(() => {})
    posthog.capture({ distinctId: '123', event: 'queued-event' })
    await vi.advanceTimersByTimeAsync(0)
    const shutdown = posthog.shutdown(100)
    await vi.advanceTimersByTimeAsync(0)

    respond(new Response(new ReadableStream(), { status: 503 }))
    try {
      await vi.advanceTimersByTimeAsync(100)
      await shutdown

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(JSON.parse(fetch.mock.calls[1][1]?.body as string).batch).toMatchObject([{ event: 'queued-event' }])
      await expect(delivery).resolves.toBeUndefined()
    } finally {
      await vi.advanceTimersByTimeAsync(10000)
      await Promise.allSettled([delivery, shutdown])
    }
  })
})
