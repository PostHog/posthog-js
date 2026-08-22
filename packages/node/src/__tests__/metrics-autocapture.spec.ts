import { PostHog } from '@/entrypoints/index.node'
import type { PostHogOptions } from '@/types'
import {
  DEFAULT_SAMPLE_INTERVAL_MS,
  GATE_POLL_INTERVAL_MS,
  METRICS_AUTOCAPTURE_FLAG,
} from '@/extensions/metrics-autocapture'
import { parseCgroupCpuQuota } from '@/extensions/metrics-autocapture/runtime.node'
import { waitForPromises } from './utils'

jest.mock('../version', () => ({ version: '1.2.3' }))
jest.spyOn(console, 'debug').mockImplementation()

const mockedFetch = jest.spyOn(globalThis, 'fetch').mockImplementation()

const options: PostHogOptions = {
  host: 'http://example.com',
  disableCompression: true,
  fetchRetryCount: 0,
  featureFlagsRequestMaxRetries: 0,
  metrics: { serviceName: 'test-service' },
}

/**
 * Serves flag definitions for local evaluation with the gate flag rolled out to
 * either everyone or nobody, plus 200s for every write endpoint.
 */
const mockApi = (gateEnabled: boolean): void => {
  mockedFetch.mockImplementation((url: any): Promise<any> => {
    if (String(url).includes('flags/definitions')) {
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve('ok'),
        headers: { get: () => null },
        json: () =>
          Promise.resolve({
            flags: [
              {
                id: 1,
                name: 'Metrics SDK autocapture',
                key: METRICS_AUTOCAPTURE_FLAG,
                active: true,
                filters: { groups: [{ rollout_percentage: gateEnabled ? 100 : 0 }] },
              },
            ],
            group_type_mapping: {},
            cohorts: {},
          }),
      })
    }
    return Promise.resolve({ status: 200, text: () => Promise.resolve('ok') })
  })
}

const localEvaluationOptions: PostHogOptions = { ...options, secretKey: 'phx_test' }

const flagsCalls = (): any[] => mockedFetch.mock.calls.filter((call) => String(call[0]).includes('/flags/?'))

const metricNames = (): string[] => {
  const names = new Set<string>()
  for (const call of mockedFetch.mock.calls) {
    if (!String(call[0]).includes('/i/v1/metrics')) {
      continue
    }
    const body = JSON.parse((call[1] as any).body)
    for (const metric of body.resourceMetrics[0].scopeMetrics[0].metrics) {
      names.add(metric.name)
    }
  }
  return [...names]
}

describe('PostHog Node.js metrics autocapture', () => {
  let posthog: PostHog

  jest.useFakeTimers()

  beforeEach(() => {
    mockedFetch.mockReset()
    mockApi(true)
  })

  afterEach(async () => {
    await posthog?.shutdown()
  })

  describe('when explicitly enabled', () => {
    beforeEach(() => {
      posthog = new PostHog('TEST_API_KEY', { ...options, enableMetricsAutocapture: true })
    })

    it('collects runtime metrics on the sample interval without any instrumentation', async () => {
      await jest.advanceTimersByTimeAsync(DEFAULT_SAMPLE_INTERVAL_MS)
      await posthog.metrics.flush()

      const names = metricNames()
      expect(names).toEqual(
        expect.arrayContaining([
          'process.cpu.time',
          'process.cpu.utilization',
          'process.memory.usage',
          'process.memory.heap_limit',
          'process.event_loop.delay',
          'process.event_loop.utilization',
          'process.uptime',
          'process.active_resources',
        ])
      )
    })

    it('breaks memory down by type and event loop delay by stat, and nothing else', async () => {
      await jest.advanceTimersByTimeAsync(DEFAULT_SAMPLE_INTERVAL_MS)
      await posthog.metrics.flush()

      const metricsCall = mockedFetch.mock.calls.find((call) => String(call[0]).includes('/i/v1/metrics'))!
      const metrics = JSON.parse((metricsCall[1] as any).body).resourceMetrics[0].scopeMetrics[0].metrics
      const byName = Object.fromEntries(metrics.map((m: any) => [m.name, m]))

      const attributeValues = (metric: any, key: string): string[] => {
        const dataPoints: any[] = metric.gauge ? metric.gauge.dataPoints : metric.sum.dataPoints
        return dataPoints.map((point) => point.attributes.find((attr: any) => attr.key === key)?.value.stringValue)
      }

      expect(attributeValues(byName['process.memory.usage'], 'type').sort()).toEqual([
        'array_buffers',
        'external',
        'heap_total',
        'heap_used',
        'rss',
      ])
      // `mean` is NaN until the event loop monitor has seen a tick, and NaN
      // samples are dropped rather than shipped as a bogus data point.
      const delayStats = attributeValues(byName['process.event_loop.delay'], 'stat').sort()
      expect(delayStats).toEqual(expect.arrayContaining(['max', 'p50', 'p90', 'p99']))
      expect(delayStats.every((stat) => ['mean', 'p50', 'p90', 'p99', 'max'].includes(stat))).toBe(true)
      expect(attributeValues(byName['process.cpu.time'], 'state').sort()).toEqual(['system', 'user'])
      // No per-host or per-instance attributes — those would be a series per box.
      expect(byName['process.uptime'].gauge.dataPoints[0].attributes).toEqual([])
    })

    it('does not evaluate the gate flag', async () => {
      await jest.advanceTimersByTimeAsync(DEFAULT_SAMPLE_INTERVAL_MS)

      expect(flagsCalls()).toHaveLength(0)
    })

    it('respects a custom sample interval', async () => {
      await posthog.shutdown()
      posthog = new PostHog('TEST_API_KEY', {
        ...options,
        enableMetricsAutocapture: true,
        metricsAutocaptureIntervalMs: 60000,
      })

      await jest.advanceTimersByTimeAsync(DEFAULT_SAMPLE_INTERVAL_MS)
      await posthog.metrics.flush()
      expect(metricNames()).toHaveLength(0)

      await jest.advanceTimersByTimeAsync(60000)
      await posthog.metrics.flush()
      expect(metricNames()).toContain('process.memory.usage')
    })

    it('stops sampling on shutdown', async () => {
      await jest.advanceTimersByTimeAsync(DEFAULT_SAMPLE_INTERVAL_MS)
      await posthog.shutdown()
      mockedFetch.mockClear()

      await jest.advanceTimersByTimeAsync(DEFAULT_SAMPLE_INTERVAL_MS * 5)

      expect(metricNames()).toHaveLength(0)
    })
  })

  it('collects nothing when explicitly disabled', async () => {
    posthog = new PostHog('TEST_API_KEY', { ...localEvaluationOptions, enableMetricsAutocapture: false })

    await jest.advanceTimersByTimeAsync(DEFAULT_SAMPLE_INTERVAL_MS * 2)
    await posthog.metrics.flush()

    expect(metricNames()).toHaveLength(0)
  })

  it('stays off when left to the flag but local evaluation is unavailable', async () => {
    // Without the poller the gate would cost a `/flags` request per poll, so it
    // stays closed rather than adding an unasked-for request to every client.
    posthog = new PostHog('TEST_API_KEY', options)
    await waitForPromises()

    await jest.advanceTimersByTimeAsync(GATE_POLL_INTERVAL_MS * 2)
    await posthog.metrics.flush()

    expect(metricNames()).toHaveLength(0)
    expect(flagsCalls()).toHaveLength(0)
  })

  describe('when left to the feature flag', () => {
    it('collects runtime metrics once the flag evaluates to true', async () => {
      posthog = new PostHog('TEST_API_KEY', localEvaluationOptions)
      await waitForPromises()

      await jest.advanceTimersByTimeAsync(DEFAULT_SAMPLE_INTERVAL_MS)
      await posthog.metrics.flush()

      expect(metricNames()).toContain('process.memory.usage')
      // Local evaluation only: the gate never costs a `/flags` request.
      expect(flagsCalls()).toHaveLength(0)
    })

    it('does not capture a $feature_flag_called event for its own gate', async () => {
      // The SDK evaluating a flag about itself must not bill the user for an
      // event, nor attach one to the synthetic gate distinct ID.
      posthog = new PostHog('TEST_API_KEY', localEvaluationOptions)
      await waitForPromises()
      await jest.advanceTimersByTimeAsync(GATE_POLL_INTERVAL_MS)
      await posthog.flush()

      expect(mockedFetch.mock.calls.filter((call) => String(call[0]).includes('/batch/'))).toHaveLength(0)
    })

    it('collects nothing while the flag evaluates to false', async () => {
      mockApi(false)
      posthog = new PostHog('TEST_API_KEY', localEvaluationOptions)
      await waitForPromises()

      await jest.advanceTimersByTimeAsync(DEFAULT_SAMPLE_INTERVAL_MS * 2)
      await posthog.metrics.flush()

      expect(metricNames()).toHaveLength(0)
    })

    it('acts as a kill switch: stops collecting when the flag is turned off', async () => {
      posthog = new PostHog('TEST_API_KEY', localEvaluationOptions)
      await waitForPromises()
      await jest.advanceTimersByTimeAsync(DEFAULT_SAMPLE_INTERVAL_MS)
      await posthog.metrics.flush()
      expect(metricNames()).toContain('process.memory.usage')

      mockApi(false)
      // One poll interval refreshes the cached definitions, the next re-evaluates
      // the gate against them and closes it.
      for (let i = 0; i < 3; i++) {
        await jest.advanceTimersByTimeAsync(GATE_POLL_INTERVAL_MS)
        await waitForPromises()
      }
      mockedFetch.mockClear()

      await jest.advanceTimersByTimeAsync(DEFAULT_SAMPLE_INTERVAL_MS * 3)
      await posthog.metrics.flush()

      expect(metricNames()).toHaveLength(0)
    })

    it('stays off and keeps polling when the definitions load fails', async () => {
      mockedFetch.mockRejectedValue(new Error('connection refused'))
      posthog = new PostHog('TEST_API_KEY', localEvaluationOptions)
      await waitForPromises()

      await jest.advanceTimersByTimeAsync(DEFAULT_SAMPLE_INTERVAL_MS * 2)
      expect(metricNames()).toHaveLength(0)

      mockApi(true)
      for (let i = 0; i < 3; i++) {
        await jest.advanceTimersByTimeAsync(GATE_POLL_INTERVAL_MS)
        await waitForPromises()
      }
      await jest.advanceTimersByTimeAsync(DEFAULT_SAMPLE_INTERVAL_MS)
      await posthog.metrics.flush()

      expect(metricNames()).toContain('process.memory.usage')
    })
  })
})

describe('cgroup CPU quota parsing', () => {
  it.each([
    // A pod limited to 500m: without this the utilization denominator would be
    // the host's core count and the ratio would read 100x too low.
    [{ cpuMax: '50000 100000' }, 0.5],
    [{ cpuMax: '200000 100000\n' }, 2],
    // Unlimited, in both cgroup versions — fall back to available parallelism.
    [{ cpuMax: 'max 100000' }, undefined],
    [{ cfsQuotaUs: '-1', cfsPeriodUs: '100000' }, undefined],
    [{ cfsQuotaUs: '150000', cfsPeriodUs: '100000' }, 1.5],
    // No cgroup filesystem at all.
    [{}, undefined],
  ])('parses %j as %s cores', (files, expected) => {
    expect(parseCgroupCpuQuota(files)).toBe(expected)
  })
})
