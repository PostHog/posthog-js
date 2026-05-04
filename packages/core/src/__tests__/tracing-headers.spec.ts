import { patchFetchForTracingHeaders, TracingHeadersClient } from '../tracing-headers'

describe('patchFetchForTracingHeaders', () => {
  jest.useRealTimers()

  const globalAny = globalThis as unknown as { fetch: typeof fetch | undefined }
  let originalFetch: typeof fetch | undefined
  let mockFetch: jest.Mock
  let restore: (() => void) | undefined

  const makeClient = (distinctId: string, sessionId: string): TracingHeadersClient => ({
    getDistinctId: () => distinctId,
    getSessionId: () => sessionId,
  })

  beforeEach(() => {
    originalFetch = globalAny.fetch
    mockFetch = jest.fn(async () => ({ status: 200 }))
    globalAny.fetch = mockFetch as unknown as typeof fetch
  })

  afterEach(() => {
    restore?.()
    restore = undefined
    globalAny.fetch = originalFetch
  })

  it.each([
    {
      label: 'string input, matching hostname',
      input: (): RequestInfo | URL => 'https://api.example.com/thing',
      expectHeaders: true,
    },
    {
      label: 'string input, non-matching hostname',
      input: (): RequestInfo | URL => 'https://other.example.com/thing',
      expectHeaders: false,
    },
    {
      label: 'URL input, matching hostname',
      input: (): RequestInfo | URL => new URL('https://api.example.com/thing'),
      expectHeaders: true,
    },
    {
      label: 'Request input, matching hostname',
      input: (): RequestInfo | URL => new Request('https://api.example.com/thing'),
      expectHeaders: true,
    },
  ])('$label', async ({ input, expectHeaders }) => {
    restore = patchFetchForTracingHeaders(makeClient('d-1', 's-1'), ['api.example.com'])

    await globalAny.fetch!(input())

    const [, init] = mockFetch.mock.calls[0]
    if (expectHeaders) {
      const headers = init.headers as Headers
      expect(headers.get('X-POSTHOG-DISTINCT-ID')).toBe('d-1')
      expect(headers.get('X-POSTHOG-SESSION-ID')).toBe('s-1')
    } else {
      expect(init).toBeUndefined()
    }
  })

  it('preserves caller-provided headers and init fields (plain object headers)', async () => {
    restore = patchFetchForTracingHeaders(makeClient('d-1', 's-1'), ['api.example.com'])

    await globalAny.fetch!('https://api.example.com/thing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer abc' },
      body: '{}',
    })

    const [, init] = mockFetch.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{}')
    const headers = init.headers as Headers
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('Authorization')).toBe('Bearer abc')
    expect(headers.get('X-POSTHOG-DISTINCT-ID')).toBe('d-1')
    expect(headers.get('X-POSTHOG-SESSION-ID')).toBe('s-1')
  })

  it('preserves caller-provided Headers instance on init.headers', async () => {
    restore = patchFetchForTracingHeaders(makeClient('d-1', 's-1'), ['api.example.com'])

    const callerHeaders = new Headers({ 'X-Caller': 'c' })
    await globalAny.fetch!('https://api.example.com/thing', { headers: callerHeaders })

    const [, init] = mockFetch.mock.calls[0]
    const headers = init.headers as Headers
    expect(headers.get('X-Caller')).toBe('c')
    expect(headers.get('X-POSTHOG-DISTINCT-ID')).toBe('d-1')
    expect(headers.get('X-POSTHOG-SESSION-ID')).toBe('s-1')
  })

  it('preserves caller-provided headers when fetch is called with a Request', async () => {
    restore = patchFetchForTracingHeaders(makeClient('d-1', 's-1'), ['api.example.com'])

    const request = new Request('https://api.example.com/thing', { headers: { 'X-Caller': 'c' } })
    await globalAny.fetch!(request)

    const [, init] = mockFetch.mock.calls[0]
    const headers = init.headers as Headers
    expect(headers.get('X-Caller')).toBe('c')
    expect(headers.get('X-POSTHOG-DISTINCT-ID')).toBe('d-1')
    expect(headers.get('X-POSTHOG-SESSION-ID')).toBe('s-1')
  })

  it('reads the current distinct/session id on every call', async () => {
    let distinct = 'd-1'
    let session = 's-1'
    const client: TracingHeadersClient = {
      getDistinctId: () => distinct,
      getSessionId: () => session,
    }

    restore = patchFetchForTracingHeaders(client, ['api.example.com'])

    await globalAny.fetch!('https://api.example.com/a')
    distinct = 'd-2'
    session = 's-2'
    await globalAny.fetch!('https://api.example.com/b')

    const firstHeaders = mockFetch.mock.calls[0][1].headers as Headers
    const secondHeaders = mockFetch.mock.calls[1][1].headers as Headers
    expect(firstHeaders.get('X-POSTHOG-DISTINCT-ID')).toBe('d-1')
    expect(firstHeaders.get('X-POSTHOG-SESSION-ID')).toBe('s-1')
    expect(secondHeaders.get('X-POSTHOG-DISTINCT-ID')).toBe('d-2')
    expect(secondHeaders.get('X-POSTHOG-SESSION-ID')).toBe('s-2')
  })

  it('ignores invalid URLs without throwing', async () => {
    restore = patchFetchForTracingHeaders(makeClient('d-1', 's-1'), ['api.example.com'])

    await expect(globalAny.fetch!('not a url')).resolves.toEqual({ status: 200 })
    const [, init] = mockFetch.mock.calls[0]
    expect(init).toBeUndefined()
  })

  it('matches the hostnames from issue #3196 (localhost and 127.0.0.1 with ports)', async () => {
    // Mirrors the user's config in https://github.com/PostHog/posthog-js/issues/3196
    restore = patchFetchForTracingHeaders(makeClient('d-1', 's-1'), [
      'localhost',
      'localhost:8000',
      '127.0.0.1',
      '127.0.0.1:8000',
    ])

    await globalAny.fetch!('http://localhost:8000/api/chat')
    await globalAny.fetch!('http://127.0.0.1:8000/api/chat')

    for (const call of mockFetch.mock.calls) {
      const headers = call[1].headers as Headers
      expect(headers.get('X-POSTHOG-DISTINCT-ID')).toBe('d-1')
      expect(headers.get('X-POSTHOG-SESSION-ID')).toBe('s-1')
    }
  })

  it('propagates rejections from the underlying fetch transparently', async () => {
    const err = new Error('network down')
    mockFetch.mockRejectedValueOnce(err)
    restore = patchFetchForTracingHeaders(makeClient('d-1', 's-1'), ['api.example.com'])

    await expect(globalAny.fetch!('https://api.example.com/thing')).rejects.toBe(err)
  })

  it('restore() returns fetch to the original implementation', async () => {
    restore = patchFetchForTracingHeaders(makeClient('d-1', 's-1'), ['api.example.com'])
    const patched = globalAny.fetch
    expect(patched).not.toBe(mockFetch)

    restore()
    expect(globalAny.fetch).toBe(mockFetch)
  })

  it('is a no-op if fetch is not available', () => {
    globalAny.fetch = undefined
    const noop = patchFetchForTracingHeaders(makeClient('d-1', 's-1'), ['api.example.com'])
    expect(globalAny.fetch).toBeUndefined()
    noop()
  })

  it('does not stack patches when re-initialised (idempotent)', async () => {
    // Simulate two PostHog instances being created back-to-back (e.g. HMR, tests).
    // The second patch should replace the first, not layer on top of it.
    const firstRestore = patchFetchForTracingHeaders(makeClient('d-old', 's-old'), ['api.example.com'])
    restore = patchFetchForTracingHeaders(makeClient('d-new', 's-new'), ['api.example.com'])

    await globalAny.fetch!('https://api.example.com/thing')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const headers = mockFetch.mock.calls[0][1].headers as Headers
    expect(headers.get('X-POSTHOG-DISTINCT-ID')).toBe('d-new')
    expect(headers.get('X-POSTHOG-SESSION-ID')).toBe('s-new')

    // The latest restore should fully unwind back to the original fetch.
    restore()
    expect(globalAny.fetch).toBe(mockFetch)

    // The earlier restore is now a no-op (its wrapped fetch is no longer installed).
    firstRestore()
    expect(globalAny.fetch).toBe(mockFetch)
  })
})
