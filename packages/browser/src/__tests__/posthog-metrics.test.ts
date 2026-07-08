import { PostHogMetrics } from '../posthog-metrics'
import { PostHog } from '../posthog-core'

const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}

jest.mock('../utils/logger', () => ({
    createLogger: jest.fn(() => mockLogger),
}))

describe('posthog-metrics', () => {
    let mockPostHog: PostHog
    let metrics: PostHogMetrics

    const sentRequests = (): any[] => (mockPostHog._send_request as jest.Mock).mock.calls.map((c) => c[0])

    const respondWithStatus = (statusCode: number): void => {
        ;(mockPostHog._send_request as jest.Mock).mockImplementation((opts: any) => opts.callback?.({ statusCode }))
    }

    beforeEach(() => {
        jest.clearAllMocks()
        jest.useFakeTimers()

        mockPostHog = {
            __loaded: true,
            config: {
                token: 'test-token',
                metrics: { serviceName: 'checkout-web' },
            },
            requestRouter: {
                endpointFor: jest.fn((_kind: string, path: string) => `https://us.i.posthog.com${path}`),
            },
            _send_request: jest.fn((opts: any) => opts.callback?.({ statusCode: 200 })),
            is_capturing: jest.fn(() => true),
        } as unknown as PostHog

        metrics = new PostHogMetrics(mockPostHog)
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('sends aggregated metrics to /i/v1/metrics with the project token', async () => {
        metrics.count('orders_created', 1)
        metrics.count('orders_created', 2)
        await metrics.flush()

        const requests = sentRequests()
        expect(requests).toHaveLength(1)
        expect(requests[0].url).toBe('https://us.i.posthog.com/i/v1/metrics?token=test-token')
        expect(requests[0].method).toBe('POST')
        expect(requests[0].batchKey).toBe('metrics')

        const metric = requests[0].data.resourceMetrics[0].scopeMetrics[0].metrics[0]
        expect(metric.name).toBe('orders_created')
        expect(metric.sum.dataPoints[0].asDouble).toBe(3)

        const resourceAttrs = requests[0].data.resourceMetrics[0].resource.attributes
        expect(resourceAttrs).toContainEqual({ key: 'service.name', value: { stringValue: 'checkout-web' } })
    })

    it('flushes automatically on the interval', () => {
        metrics.gauge('active_connections', 42)
        expect(mockPostHog._send_request).not.toHaveBeenCalled()

        jest.advanceTimersByTime(10000)
        expect(mockPostHog._send_request).toHaveBeenCalledTimes(1)
    })

    it('retains the window on transient failures and drops it on client errors', async () => {
        respondWithStatus(429)
        metrics.count('a', 5)
        await metrics.flush()

        respondWithStatus(200)
        await metrics.flush()
        expect(sentRequests()[1].data.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0].asDouble).toBe(5)

        respondWithStatus(400)
        metrics.count('b', 1)
        await metrics.flush()

        respondWithStatus(200)
        metrics.count('b', 2)
        await metrics.flush()
        const last = sentRequests()[3].data.resourceMetrics[0].scopeMetrics[0].metrics[0]
        expect(last.name).toBe('b')
        expect(last.sum.dataPoints[0].asDouble).toBe(2)
    })

    it('captures nothing when the instance is not capturing', async () => {
        ;(mockPostHog.is_capturing as jest.Mock).mockReturnValue(false)
        metrics.count('a', 1)
        await metrics.flush()
        expect(mockPostHog._send_request).not.toHaveBeenCalled()
    })

    it('drains over the given transport on flush(transport)', () => {
        metrics.histogram('api_latency', 187, { unit: 'ms' })
        metrics.flush('sendBeacon')

        const requests = sentRequests()
        expect(requests).toHaveLength(1)
        expect(requests[0].transport).toBe('sendBeacon')
        const metric = requests[0].data.resourceMetrics[0].scopeMetrics[0].metrics[0]
        expect(metric.unit).toBe('ms')
        expect(metric.histogram.dataPoints[0].count).toBe(1)
    })

    it('rebuilds the aggregator when the metrics config object is swapped', async () => {
        metrics.count('a', 1)
        await metrics.flush()
        ;(mockPostHog.config as any).metrics = { serviceName: 'renamed-service' }
        metrics.count('a', 1)
        await metrics.flush()

        const resourceAttrs = sentRequests()[1].data.resourceMetrics[0].resource.attributes
        expect(resourceAttrs).toContainEqual({ key: 'service.name', value: { stringValue: 'renamed-service' } })
    })
})
