import { PostHog, PostHogOptions } from '@/entrypoints/index.node'
import type { IPostHog } from '@/types'

jest.mock('../version', () => ({ version: '1.2.3' }))

const mockedFetch = jest.spyOn(globalThis, 'fetch').mockImplementation()

const options: PostHogOptions = {
  host: 'http://example.com',
  disableCompression: true,
  fetchRetryCount: 0,
  metrics: { serviceName: 'test-service' },
}

describe('PostHog Node.js metrics', () => {
  let posthog: PostHog

  jest.useFakeTimers()

  beforeEach(() => {
    mockedFetch.mockReset()
    mockedFetch.mockResolvedValue({ status: 200, text: async () => '' } as any)
    posthog = new PostHog('TEST_API_KEY', options)
  })

  afterEach(async () => {
    await posthog.shutdown()
  })

  const metricsCalls = (): [string, any][] =>
    mockedFetch.mock.calls.filter((call) => (call[0] as string).includes('/i/v1/metrics')) as [string, any][]

  const lastMetricsBody = (): any => {
    const calls = metricsCalls()
    return JSON.parse(calls[calls.length - 1][1].body)
  }

  const metricsByName = (body: any): Record<string, any> =>
    Object.fromEntries(body.resourceMetrics[0].scopeMetrics[0].metrics.map((m: any) => [m.name, m]))

  it('aggregates samples and flushes them as OTLP JSON to /i/v1/metrics with the project token', async () => {
    posthog.metrics.count('jobs.processed', 1, { attributes: { queue: 'default' } })
    posthog.metrics.count('jobs.processed', 1, { attributes: { queue: 'default' } })
    posthog.metrics.gauge('queue.depth', 7)
    posthog.metrics.histogram('job.duration', 42, { unit: 'ms' })

    await posthog.metrics.flush()

    const [url] = metricsCalls()[0]
    expect(url).toBe('http://example.com/i/v1/metrics?token=TEST_API_KEY')

    const body = lastMetricsBody()
    expect(body.resourceMetrics[0].resource.attributes).toContainEqual({
      key: 'service.name',
      value: { stringValue: 'test-service' },
    })

    const metrics = metricsByName(body)
    expect(metrics['jobs.processed'].sum.dataPoints[0].asDouble).toBe(2)
    expect(metrics['jobs.processed'].sum.isMonotonic).toBe(true)
    expect(metrics['queue.depth'].gauge.dataPoints[0].asDouble).toBe(7)
    expect(metrics['job.duration'].unit).toBe('ms')
    expect(metrics['job.duration'].histogram.dataPoints[0].count).toBe(1)
  })

  it('merges the window back and resends on network failure', async () => {
    mockedFetch.mockRejectedValueOnce(new Error('connection refused'))

    posthog.metrics.count('jobs.processed', 3)
    await posthog.metrics.flush()
    expect(metricsCalls()).toHaveLength(1)

    posthog.metrics.count('jobs.processed', 2)
    await posthog.metrics.flush()

    expect(metricsCalls()).toHaveLength(2)
    expect(metricsByName(lastMetricsBody())['jobs.processed'].sum.dataPoints[0].asDouble).toBe(5)
  })

  it.each([429, 503])('merges the window back and resends after exhausted retries on HTTP %i', async (status) => {
    mockedFetch.mockResolvedValueOnce({ status, text: async () => '' } as any)

    posthog.metrics.count('jobs.processed', 3)
    await posthog.metrics.flush()
    expect(metricsCalls()).toHaveLength(1)

    posthog.metrics.count('jobs.processed', 2)
    await posthog.metrics.flush()

    expect(metricsCalls()).toHaveLength(2)
    expect(metricsByName(lastMetricsBody())['jobs.processed'].sum.dataPoints[0].asDouble).toBe(5)
  })

  it('drops the batch on 413 instead of retrying it forever', async () => {
    mockedFetch.mockResolvedValueOnce({ status: 413, text: async () => '' } as any)

    posthog.metrics.count('jobs.processed', 3)
    await posthog.metrics.flush()

    posthog.metrics.count('jobs.processed', 2)
    await posthog.metrics.flush()

    expect(metricsByName(lastMetricsBody())['jobs.processed'].sum.dataPoints[0].asDouble).toBe(2)
  })

  it('flushes pending metrics on shutdown', async () => {
    posthog.metrics.count('jobs.processed', 4)

    await posthog.shutdown()

    expect(metricsCalls()).toHaveLength(1)
    expect(metricsByName(lastMetricsBody())['jobs.processed'].sum.dataPoints[0].asDouble).toBe(4)
  })

  it('is reachable through the IPostHog interface', () => {
    // Compile-time check: `metrics` must be part of the exported interface,
    // not just the concrete client class.
    const asInterface: IPostHog = posthog
    expect(typeof asInterface.metrics.count).toBe('function')
  })

  it('captures nothing while disabled', async () => {
    const disabled = new PostHog('TEST_API_KEY', { ...options, disabled: true })
    disabled.metrics.count('jobs.processed', 1)

    await disabled.metrics.flush()
    await disabled.shutdown()

    expect(metricsCalls()).toHaveLength(0)
  })

  it('discards a metrics window whose raced-out flush completes after shutdown', async () => {
    let rejectFetch!: (e: Error) => void
    mockedFetch.mockImplementation(() => new Promise((_, reject) => (rejectFetch = reject)) as any)

    posthog.metrics.count('jobs.processed', 1)
    const shutdown = posthog.shutdown(100)
    await jest.advanceTimersByTimeAsync(150)
    await shutdown
    expect(metricsCalls()).toHaveLength(1)

    // The flush that lost the shutdown race finally fails with a retryable
    // error — after teardown its window must be discarded, not merged back
    // onto a re-armed flush timer.
    rejectFetch(new Error('connection refused'))
    await jest.advanceTimersByTimeAsync(60_000)

    expect(metricsCalls()).toHaveLength(1)
  })

  it('bounds the shutdown metrics flush by the shutdown timeout', async () => {
    // A hung transport must not hold shutdown past the caller's deadline — the
    // metrics flush runs before the events flush starts its own timeout.
    posthog.metrics.count('jobs.processed', 1)
    mockedFetch.mockImplementation(() => new Promise(() => {}) as any)

    const shutdown = posthog.shutdown(500)
    await jest.advanceTimersByTimeAsync(600)

    await expect(shutdown).resolves.toBeUndefined()
  })

  it('shares one shutdown deadline between the metrics flush and the event flush', async () => {
    // Separate client: its hung sends would wedge the shared afterEach shutdown.
    const client = new PostHog('TEST_API_KEY', options)
    mockedFetch.mockImplementation(() => new Promise(() => {}) as any)
    client.metrics.count('jobs.processed', 1)
    client.capture({ distinctId: 'user-1', event: 'order created' })

    // With both transports hung, shutdown(500) must settle by the deadline —
    // not spend the full budget on the metrics race and then grant the event
    // flush a fresh full budget on top.
    let settled = false
    client
      .shutdown(500)
      .catch(() => {})
      .finally(() => {
        settled = true
      })
    await jest.advanceTimersByTimeAsync(600)

    expect(settled).toBe(true)
  })
})
