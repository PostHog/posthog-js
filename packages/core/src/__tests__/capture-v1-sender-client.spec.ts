import { V1CaptureSender, type V1SendDeferral, serializeV1Event } from '@/capture-v1'
import type { PostHogFetchResponse } from '@/types'

const response = (status: number, body: unknown = {}, headers: Record<string, string> = {}): PostHogFetchResponse => ({
  status,
  text: () => Promise.resolve(JSON.stringify(body)),
  json: () => Promise.resolve(body),
  headers: { get: (name: string) => headers[name] ?? null },
  body: null,
})

const event = (uuid: string) =>
  serializeV1Event({ event: 'test', distinct_id: 'user', uuid, properties: {}, timestamp: '2024-01-01T00:00:00.000Z' })

const UUID_A = '0198c0de-1234-7abc-8def-0123456789a1'
const UUID_B = '0198c0de-1234-7abc-8def-0123456789a2'

const makeSender = (fetch: vi.Mock, extraHeaders?: Record<string, string>) => {
  const errors: unknown[] = []
  const sender = new V1CaptureSender(
    {
      host: 'https://t.posthog.com',
      path: '/i/v1/analytics/events',
      apiKey: 'phc_test',
      libraryId: 'posthog-react-native',
      libraryVersion: '5.0.0',
      userAgent: 'posthog-react-native/5.0.0',
      extraHeaders,
      historicalMigration: false,
      compression: 'none',
      requestTimeoutMs: 1000,
      maxRetries: 0,
    },
    { fetch, onError: (error) => errors.push(error), sleep: () => Promise.resolve() }
  )
  return { sender, errors }
}

describe('V1CaptureSender durable-queue options', () => {
  it('sends extra headers, but its own headers win whatever their case', async () => {
    const fetch = vi.fn().mockResolvedValue(response(200, { results: {} }))
    const { sender } = makeSender(fetch, {
      authorization: 'Bearer app-jwt',
      'user-agent': 'my-app/1',
      'Content-Encoding': 'br',
      'X-Proxy-Token': 'proxy',
    })

    await sender.send([event(UUID_A)])

    const headers = fetch.mock.calls[0][1].headers
    expect(headers).toMatchObject({
      Authorization: 'Bearer phc_test',
      'User-Agent': 'posthog-react-native/5.0.0',
      'X-Proxy-Token': 'proxy',
    })
    expect(headers).not.toHaveProperty('authorization')
    expect(headers).not.toHaveProperty('user-agent')
    expect(headers).not.toHaveProperty('Content-Encoding')
  })

  it.each([404, 408, 429, 500, 502, 503, 504])(
    'returns the batch unreported after a %s on the last attempt',
    async (status) => {
      const fetch = vi.fn().mockResolvedValue(response(status, {}, { 'Retry-After': '7' }))
      const { sender, errors } = makeSender(fetch)
      const deferrals: V1SendDeferral[] = []
      const events = [event(UUID_A)]

      const kept = await sender.send(events, { onDeferred: (deferral) => deferrals.push(deferral) })

      expect(kept).toEqual(events)
      expect(deferrals).toEqual([{ retryAfterMs: 7000, tooLarge: false }])
      expect(errors).toEqual([])
    }
  )

  it('returns events marked retry and reports the dropped ones', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(response(200, { results: { [UUID_A]: { result: 'retry' }, [UUID_B]: { result: 'drop' } } }))
    const { sender, errors } = makeSender(fetch)
    const deferrals: V1SendDeferral[] = []
    const a = event(UUID_A)

    const kept = await sender.send([a, event(UUID_B)], { onDeferred: (deferral) => deferrals.push(deferral) })

    expect(kept).toEqual([a])
    expect(deferrals).toEqual([{ retryAfterMs: undefined, tooLarge: false }])
    expect(errors).toEqual([
      expect.objectContaining({ drops: [{ uuid: UUID_B, details: undefined }], retryExhausted: [] }),
    ])
  })

  it('returns a batch of more than one event that got a 413, and reports a single event', async () => {
    const fetch = vi.fn().mockResolvedValue(response(413))
    const { sender, errors } = makeSender(fetch)
    const deferrals: V1SendDeferral[] = []
    const events = [event(UUID_A), event(UUID_B)]

    expect(await sender.send(events, { onDeferred: (deferral) => deferrals.push(deferral) })).toEqual(events)
    expect(deferrals).toEqual([{ retryAfterMs: undefined, tooLarge: true }])

    expect(await sender.send([event(UUID_A)], { onDeferred: (deferral) => deferrals.push(deferral) })).toEqual([])
    expect(errors).toEqual([expect.objectContaining({ retryExhausted: [UUID_A] })])
  })

  it('reports retryable failures as before without onDeferred', async () => {
    const fetch = vi.fn().mockResolvedValue(response(503))
    const { sender, errors } = makeSender(fetch)

    expect(await sender.send([event(UUID_A)])).toEqual([])
    expect(errors).toEqual([expect.objectContaining({ retryExhausted: [UUID_A] })])
  })
})
