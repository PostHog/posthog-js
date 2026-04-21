import { patchFetchForTracingHeaders } from '../src/tracing-headers'
import type { PostHog } from '../src/posthog-rn'

describe('patchFetchForTracingHeaders', () => {
  const globalAny = globalThis as any
  let originalFetch: typeof fetch | undefined
  let mockFetch: jest.Mock
  let restore: (() => void) | undefined

  const makeInstance = (distinctId: string, sessionId: string): PostHog =>
    ({
      getDistinctId: () => distinctId,
      getSessionId: () => sessionId,
    }) as unknown as PostHog

  beforeEach(() => {
    originalFetch = globalAny.fetch
    mockFetch = jest.fn(async () => ({ status: 200 }))
    globalAny.fetch = mockFetch
  })

  afterEach(() => {
    restore?.()
    restore = undefined
    globalAny.fetch = originalFetch
  })

  it.each([
    { label: 'adds headers for a matching hostname', url: 'https://api.example.com/thing', expectHeaders: true },
    {
      label: 'does not add headers for a non-matching hostname',
      url: 'https://other.example.com/thing',
      expectHeaders: false,
    },
  ])('$label', async ({ url, expectHeaders }) => {
    restore = patchFetchForTracingHeaders(makeInstance('d-1', 's-1'), ['api.example.com'])

    await globalAny.fetch(url)

    const [, init] = mockFetch.mock.calls[0]
    if (expectHeaders) {
      const headers = init.headers as Headers
      expect(headers.get('X-POSTHOG-DISTINCT-ID')).toBe('d-1')
      expect(headers.get('X-POSTHOG-SESSION-ID')).toBe('s-1')
    } else {
      expect(init).toBeUndefined()
    }
  })

  it('preserves caller-provided headers and init fields', async () => {
    restore = patchFetchForTracingHeaders(makeInstance('d-1', 's-1'), ['api.example.com'])

    await globalAny.fetch('https://api.example.com/thing', {
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

  it('reads the current distinct/session id on every call', async () => {
    let distinct = 'd-1'
    let session = 's-1'
    const instance = {
      getDistinctId: () => distinct,
      getSessionId: () => session,
    } as unknown as PostHog

    restore = patchFetchForTracingHeaders(instance, ['api.example.com'])

    await globalAny.fetch('https://api.example.com/a')
    distinct = 'd-2'
    session = 's-2'
    await globalAny.fetch('https://api.example.com/b')

    const firstHeaders = mockFetch.mock.calls[0][1].headers as Headers
    const secondHeaders = mockFetch.mock.calls[1][1].headers as Headers
    expect(firstHeaders.get('X-POSTHOG-DISTINCT-ID')).toBe('d-1')
    expect(firstHeaders.get('X-POSTHOG-SESSION-ID')).toBe('s-1')
    expect(secondHeaders.get('X-POSTHOG-DISTINCT-ID')).toBe('d-2')
    expect(secondHeaders.get('X-POSTHOG-SESSION-ID')).toBe('s-2')
  })

  it('ignores invalid URLs without throwing', async () => {
    restore = patchFetchForTracingHeaders(makeInstance('d-1', 's-1'), ['api.example.com'])

    await expect(globalAny.fetch('not a url')).resolves.toEqual({ status: 200 })
    const [, init] = mockFetch.mock.calls[0]
    expect(init).toBeUndefined()
  })

  it('matches the hostnames from issue #3196 (localhost and 127.0.0.1 with ports)', async () => {
    // Mirrors the user's config in https://github.com/PostHog/posthog-js/issues/3196
    restore = patchFetchForTracingHeaders(makeInstance('d-1', 's-1'), [
      'localhost',
      'localhost:8000',
      '127.0.0.1',
      '127.0.0.1:8000',
    ])

    await globalAny.fetch('http://localhost:8000/api/chat')
    await globalAny.fetch('http://127.0.0.1:8000/api/chat')

    for (const call of mockFetch.mock.calls) {
      const headers = call[1].headers as Headers
      expect(headers.get('X-POSTHOG-DISTINCT-ID')).toBe('d-1')
      expect(headers.get('X-POSTHOG-SESSION-ID')).toBe('s-1')
    }
  })

  it('restore() returns fetch to the original implementation', async () => {
    restore = patchFetchForTracingHeaders(makeInstance('d-1', 's-1'), ['api.example.com'])
    const patched = globalAny.fetch
    expect(patched).not.toBe(mockFetch)

    restore()
    expect(globalAny.fetch).toBe(mockFetch)
  })

  it('is a no-op if fetch is not available', () => {
    globalAny.fetch = undefined
    const noop = patchFetchForTracingHeaders(makeInstance('d-1', 's-1'), ['api.example.com'])
    expect(globalAny.fetch).toBeUndefined()
    noop()
  })

  it('does not stack patches when re-initialised (idempotent)', async () => {
    // Simulate two PostHog instances being created back-to-back (e.g. HMR, tests).
    // The second patch should replace the first, not layer on top of it.
    const firstRestore = patchFetchForTracingHeaders(makeInstance('d-old', 's-old'), ['api.example.com'])
    restore = patchFetchForTracingHeaders(makeInstance('d-new', 's-new'), ['api.example.com'])

    await globalAny.fetch('https://api.example.com/thing')

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
