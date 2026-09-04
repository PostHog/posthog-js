import { createTestClient, PostHogCoreTestClient, PostHogCoreTestClientMocks } from '@/testing'

// The SDK will not put a body larger than the endpoint's configured limit on
// the wire. Such a batch can only come back 413, so it is reported as too-large
// without being sent — the caller's halving loop then isolates and drops the
// oversized record without spending a request on every attempt.
//
// Mirrors OTLP_MAX_BODY_BYTES. Kept as a local literal so a change to the
// shipped ceiling has to be made deliberately here too.
const LIMIT_BYTES = 10 * 1024 * 1024
const OVER_LIMIT_BYTES = LIMIT_BYTES + 1024

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

  it.each([
    ['traces', (payload: any) => posthog._sendTracesBatch(payload)],
    ['logs', (payload: any) => posthog._sendLogsBatch(payload)],
    ['metrics', (payload: any) => posthog._sendMetricsBatch(payload)],
  ])('reports a %s batch it cannot serialize as too-large rather than throwing', async (_signal, send) => {
    // A payload past the runtime's max string length throws out of
    // `JSON.stringify`. Unguarded that escapes the tagged-outcome contract, and
    // the caller retries a batch it can never send instead of halving it away.
    const unserializable: any = spansOf(8)
    unserializable.resourceSpans[0].scopeSpans[0].spans[0].self = unserializable

    await expect(send(unserializable)).resolves.toEqual({ kind: 'too-large' })
    expect(mocks.fetch).not.toHaveBeenCalled()
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
    await expect(send(spansOf(OVER_LIMIT_BYTES))).resolves.toEqual({ kind: 'too-large' })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('measures the payload, not the compressed body it is sent as', async () => {
    // The endpoint decompresses before it measures, so a payload that gzips
    // down to nothing is still refused on its decompressed size.
    vi.spyOn(posthog as any, 'compressPayload').mockResolvedValue(new Uint8Array(1024))
    ;(posthog as any).disableCompression = false

    await expect(posthog._sendTracesBatch(spansOf(OVER_LIMIT_BYTES))).resolves.toEqual({ kind: 'too-large' })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  // The endpoint rejects a body *over* its limit, so one exactly at it is
  // accepted on both sides. Pinning both directions keeps the comparison from
  // drifting to `>=`, which would refuse an acceptable batch without a request
  // and — in traces — halve it down and drop the span with no 413 to show for it.
  const overheadBytes = (): number => JSON.stringify(spansOf(1024)).length - 1024

  it('sends a batch of exactly the limit', async () => {
    const exact = LIMIT_BYTES - overheadBytes()
    expect(JSON.stringify(spansOf(exact)).length).toBe(LIMIT_BYTES)

    await expect(posthog._sendTracesBatch(spansOf(exact))).resolves.toEqual({ kind: 'ok' })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('reports a batch one byte over the limit as too-large', async () => {
    await expect(posthog._sendTracesBatch(spansOf(LIMIT_BYTES - overheadBytes() + 1))).resolves.toEqual({
      kind: 'too-large',
    })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('does not compress a batch it has already ruled out', async () => {
    // Gzipping a multi-megabyte body only to throw it away is the whole cost of
    // the attempt the size check exists to avoid, and the halving loops pay it
    // again on every step down.
    const compressPayload = vi.spyOn(posthog as any, 'compressPayload')
    ;(posthog as any).disableCompression = false

    await expect(posthog._sendTracesBatch(spansOf(OVER_LIMIT_BYTES))).resolves.toEqual({ kind: 'too-large' })
    expect(compressPayload).not.toHaveBeenCalled()
  })

  it.each([
    ['traces', (payload: any) => posthog._sendTracesBatch(payload)],
    ['logs', (payload: any) => posthog._sendLogsBatch(payload)],
    ['metrics', (payload: any) => posthog._sendMetricsBatch(payload)],
  ])('sends a %s batch the service accepts but its fallback default would not', async (_signal, send) => {
    // 3 MiB sits above the 2 MB the service falls back to and below the limit it
    // is configured with, so it is accepted today. A ceiling set to the fallback
    // would refuse it here — costing the records, since a batch of one that is
    // refused for size is dropped, and metrics drops the whole window.
    await expect(send(spansOf(3 * 1024 * 1024))).resolves.toEqual({ kind: 'ok' })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('sends a compressible payload that is inside the limit before compression', async () => {
    vi.spyOn(posthog as any, 'compressPayload').mockResolvedValue(new Uint8Array(1024))
    ;(posthog as any).disableCompression = false

    await expect(posthog._sendTracesBatch(spansOf(1024))).resolves.toEqual({ kind: 'ok' })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
})
