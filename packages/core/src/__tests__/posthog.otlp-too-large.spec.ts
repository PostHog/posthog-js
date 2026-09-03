import { createTestClient, PostHogCoreTestClient, PostHogCoreTestClientMocks } from '@/testing'

// The endpoint caps the request body at 2 MB. A batch over that can only come
// back 413, so it is reported as too-large without being sent — the caller's
// halving loop then isolates and drops the oversized record without spending a
// request on every attempt.
describe('OTLP bodies over the endpoint limit', () => {
  let posthog: PostHogCoreTestClient
  let mocks: PostHogCoreTestClientMocks

  const spansOf = (attributeBytes: number): any => ({
    resourceSpans: [
      {
        resource: { attributes: [] },
        scopeSpans: [
          {
            scope: { name: 'test' },
            spans: [
              { name: 'checkout', attributes: [{ key: 'blob', value: { stringValue: 'x'.repeat(attributeBytes) } }] },
            ],
          },
        ],
      },
    ],
  })

  beforeEach(() => {
    ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
      host: 'http://example.com',
      preloadFeatureFlags: false,
      disableCompression: true,
      fetchRetryCount: 0,
    })
    mocks.fetch.mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({}),
      headers: { get: () => null },
    })
  })

  it('sends a batch inside the limit', async () => {
    await expect(posthog._sendTracesBatch(spansOf(1024))).resolves.toEqual({ kind: 'ok' })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['traces', (payload: any) => posthog._sendTracesBatch(payload)],
    ['logs', (payload: any) => posthog._sendLogsBatch(payload)],
    ['metrics', (payload: any) => posthog._sendMetricsBatch(payload)],
  ])('reports a %s batch over the limit as too-large without a request', async (_signal, send) => {
    await expect(send(spansOf(3 * 1024 * 1024))).resolves.toEqual({ kind: 'too-large' })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('measures the payload, not the compressed body it is sent as', async () => {
    // The endpoint decompresses before it measures, so a payload that gzips
    // down to nothing is still refused on its decompressed size.
    vi.spyOn(posthog as any, 'compressPayload').mockResolvedValue(new Uint8Array(1024))
    ;(posthog as any).disableCompression = false

    await expect(posthog._sendTracesBatch(spansOf(3 * 1024 * 1024))).resolves.toEqual({ kind: 'too-large' })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  // The endpoint rejects a body *over* its limit, so one exactly at it is
  // accepted on both sides. Pinning both directions keeps the comparison from
  // drifting to `>=`, which would refuse an acceptable batch without a request
  // and — in traces — halve it down and drop the span with no 413 to show for it.
  const overheadBytes = (): number => JSON.stringify(spansOf(1024)).length - 1024

  it('sends a batch of exactly the limit', async () => {
    const exact = 2 * 1024 * 1024 - overheadBytes()
    expect(JSON.stringify(spansOf(exact)).length).toBe(2 * 1024 * 1024)

    await expect(posthog._sendTracesBatch(spansOf(exact))).resolves.toEqual({ kind: 'ok' })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('reports a batch one byte over the limit as too-large', async () => {
    await expect(posthog._sendTracesBatch(spansOf(2 * 1024 * 1024 - overheadBytes() + 1))).resolves.toEqual({
      kind: 'too-large',
    })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('sends a compressible payload that is inside the limit before compression', async () => {
    vi.spyOn(posthog as any, 'compressPayload').mockResolvedValue(new Uint8Array(1024))
    ;(posthog as any).disableCompression = false

    await expect(posthog._sendTracesBatch(spansOf(1024))).resolves.toEqual({ kind: 'ok' })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
})
