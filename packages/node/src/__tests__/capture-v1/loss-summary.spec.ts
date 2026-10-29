import { CaptureError, type PostHog, type PostHogOptions } from '@/entrypoints/index.node'

import { ANALYTICS_CAPTURE_PATH, v1Response } from '../utils'
import { V1WiringHarness } from '../utils/v1-wiring'

vi.mock('../../version', () => ({ version: '1.2.3' }))

const SERVER_TEXT = 'internal server detail 0198c0de-1234-7abc-8def-0123456789ab'
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const SECRET_PROPERTY = 'secret-property-value'

const response = (status: number, body: string, headers: Record<string, string> = {}): any => ({
  status,
  text: () => Promise.resolve(body),
  headers: { get: (name: string) => headers[name] ?? null },
  body: null,
})

describe('capture loss summary', () => {
  const harness = new V1WiringHarness()
  let warn: vi.SpyInstance

  beforeEach(() => {
    vi.useFakeTimers()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    harness.useDefaultRouting()
  })

  afterEach(async () => {
    harness.useDefaultRouting()
    await harness.cleanup()
    vi.clearAllMocks()
  })

  const lines = (): string[] => warn.mock.calls.map(([line]) => String(line))

  /** Answers capture requests in order with `responses`, then accepts everything. */
  function answerCapture(...responses: (() => Promise<any>)[]): void {
    harness.fetch.mockImplementation((url: any) => {
      if (!String(url).includes(ANALYTICS_CAPTURE_PATH)) {
        return Promise.resolve(v1Response())
      }
      const next = responses.shift()
      return next ? next() : Promise.resolve(v1Response())
    })
  }

  async function captureTwo(posthog: PostHog, immediate = false): Promise<string[]> {
    const uuids = ['0198c0de-0000-7000-8000-000000000001', '0198c0de-0000-7000-8000-000000000002']
    for (const uuid of uuids) {
      const event = { distinctId: 'u', event: 'signup', properties: { secret: SECRET_PROPERTY }, uuid }
      if (immediate) {
        await posthog.captureImmediate(event)
      } else {
        posthog.capture(event)
      }
    }
    if (!immediate) {
      const flush = posthog.flush()
      await vi.advanceTimersByTimeAsync(60_000)
      await flush
    }
    return uuids
  }

  function expectContentFree(line: string): void {
    expect(line).not.toMatch(UUID)
    expect(line).not.toContain(SERVER_TEXT)
    expect(line).not.toContain('billing')
    expect(line).not.toContain(SECRET_PROPERTY)
    expect(line).not.toContain('signup')
  }

  it.each<[string, (() => Promise<any>)[], string, PostHogOptions?]>([
    [
      'a final HTTP error',
      [() => Promise.resolve(response(400, SERVER_TEXT))],
      '2 event(s) were not delivered to /i/v1/analytics/events: 2 failed with HTTP 400',
    ],
    [
      'exhausted retries',
      [() => Promise.resolve(response(503, SERVER_TEXT)), () => Promise.resolve(response(503, SERVER_TEXT))],
      '2 event(s) were not delivered to /i/v1/analytics/events: 2 failed with HTTP 503',
      { captureMaxRetries: 1 },
    ],
    [
      'server drops and duplicates',
      [
        () =>
          Promise.resolve(
            response(
              200,
              JSON.stringify({
                results: {
                  '0198c0de-0000-7000-8000-000000000001': { result: 'drop', details: `billing ${SERVER_TEXT}` },
                  '0198c0de-0000-7000-8000-000000000002': { result: 'retry' },
                },
              })
            )
          ),
        () =>
          Promise.resolve(
            response(200, JSON.stringify({ results: { '0198c0de-0000-7000-8000-000000000002': { result: 'retry' } } }))
          ),
      ],
      '2 event(s) were not delivered to /i/v1/analytics/events: 1 dropped by the server (HTTP 200), ' +
        '1 still marked for retry after 2 attempt(s) (HTTP 200)',
      { captureMaxRetries: 1 },
    ],
    [
      'an unfollowed redirect',
      [() => Promise.resolve(response(302, SERVER_TEXT, { Location: '/elsewhere' }))],
      '2 event(s) were not delivered to /i/v1/analytics/events: 2 failed on a redirect it does not follow (HTTP 302)',
    ],
    [
      'an unreadable 2xx',
      [() => Promise.resolve(response(200, SERVER_TEXT))],
      '2 event(s) were not delivered to /i/v1/analytics/events: 2 failed with an unreadable response (HTTP 200)',
    ],
  ])('logs one content-free line for %s when nothing listens', async (_label, responses, expected, options) => {
    answerCapture(...responses)
    const posthog = harness.makeClient(options)

    await captureTwo(posthog)

    expect(lines()).toEqual([`[PostHog] ${expected}`])
    expectContentFree(lines()[0])
  })

  it('names duplicate drops', async () => {
    answerCapture(() =>
      Promise.resolve(
        response(
          200,
          JSON.stringify({
            results: { '0198c0de-0000-7000-8000-000000000001': { result: 'ok', duplicates_dropped: 1 } },
          })
        )
      )
    )
    const posthog = harness.makeClient()
    const uuid = '0198c0de-0000-7000-8000-000000000001'
    posthog.capture({ distinctId: 'u', event: 'signup', properties: {}, uuid })
    posthog.capture({ distinctId: 'u', event: 'signup', properties: {}, uuid })
    await posthog.flush()

    expect(lines()).toEqual([
      '[PostHog] 1 event(s) were not delivered to /i/v1/analytics/events: 1 dropped as duplicate uuids (HTTP 200)',
    ])
  })

  it.each<[string, () => Promise<any>, string, PostHogOptions]>([
    [
      'a network error',
      () => Promise.reject(new TypeError(`fetch failed: ${SERVER_TEXT}`)),
      '1 failed with a network error (TypeError)',
      {},
    ],
    ['a timeout', () => new Promise(() => {}), '1 failed: request timed out', { requestTimeout: 1000 }],
  ])('logs one line per immediate send lost to %s', async (_label, answer, expected, options) => {
    answerCapture(answer, answer)
    const posthog = harness.makeClient(options)

    const sends = captureTwo(posthog, true)
    await vi.advanceTimersByTimeAsync(5000)
    await sends

    expect(lines()).toEqual([
      `[PostHog] 1 event(s) were not delivered to /i/v1/analytics/events: ${expected}`,
      `[PostHog] 1 event(s) were not delivered to /i/v1/analytics/events: ${expected}`,
    ])
    lines().forEach(expectContentFree)
  })

  it('logs nothing when a network failure keeps the events for the next flush', async () => {
    answerCapture(() => Promise.reject(new TypeError('fetch failed')))
    const posthog = harness.makeClient()

    await captureTwo(posthog)

    expect(lines()).toEqual([])
  })

  it('logs one line per batch', async () => {
    answerCapture(
      () => Promise.resolve(response(400, SERVER_TEXT)),
      () => Promise.resolve(response(413, SERVER_TEXT))
    )
    const posthog = harness.makeClient({ maxBatchSize: 1, flushAt: 1 })

    await captureTwo(posthog)

    expect(lines()).toEqual([
      '[PostHog] 1 event(s) were not delivered to /i/v1/analytics/events: 1 failed with HTTP 400',
      '[PostHog] 1 event(s) were not delivered to /i/v1/analytics/events: 1 failed with HTTP 413',
    ])
  })

  it("logs nothing and hands the CaptureError to an 'error' listener", async () => {
    answerCapture(() => Promise.resolve(response(400, SERVER_TEXT)))
    const posthog = harness.makeClient()
    const errors: unknown[] = []
    posthog.on('error', (error) => errors.push(error))

    const uuids = await captureTwo(posthog)

    expect(lines()).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(CaptureError)
    expect((errors[0] as CaptureError).retryExhausted).toEqual(uuids)
  })
})
