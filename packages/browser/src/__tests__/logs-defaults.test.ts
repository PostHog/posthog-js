import { resolveLogsConfig } from '../logs-defaults'

describe('resolveLogsConfig', () => {
    it('applies browser defaults when nothing is configured', () => {
        const resolved = resolveLogsConfig(undefined)

        expect(resolved).toMatchObject({
            flushIntervalMs: 3000,
            maxBufferSize: 100,
            maxQueueSize: 1000,
            maxBatchRecordsPerPost: 100,
            rateCapWindowMs: 3000,
            maxLogsPerInterval: 1000,
            backgroundFlushBudgetMs: 0,
            terminationFlushBudgetMs: 0,
        })
        // No client-side service.name default: the core resource-attribute builder
        // fills `unknown_service` when unset, preserving the programmatic path's
        // long-standing default for existing web clients.
        expect(resolved.serviceName).toBeUndefined()
    })

    it('passes through configured values', () => {
        const resolved = resolveLogsConfig({
            serviceName: 'my-app',
            serviceVersion: '2.0.0',
            environment: 'staging',
            flushIntervalMs: 5000,
            maxBufferSize: 50,
            maxLogsPerInterval: 200,
        })

        expect(resolved).toMatchObject({
            serviceName: 'my-app',
            serviceVersion: '2.0.0',
            environment: 'staging',
            flushIntervalMs: 5000,
            maxBufferSize: 50,
            maxLogsPerInterval: 200,
        })
    })

    it('sets the eviction backstop to the larger of buffer size and rate cap', () => {
        // Default: buffer (100) < rate cap (1000) → backstop tracks the rate cap so a
        // full admitted burst is held rather than evicted at the flush threshold.
        expect(resolveLogsConfig(undefined).maxQueueSize).toBe(1000)
        // Configured buffer below its rate cap still gets headroom up to the cap.
        expect(resolveLogsConfig({ maxBufferSize: 50, maxLogsPerInterval: 200 }).maxQueueSize).toBe(200)
        // Buffer larger than the rate cap wins (never evict below the flush trigger).
        expect(resolveLogsConfig({ maxBufferSize: 2000, maxLogsPerInterval: 500 }).maxQueueSize).toBe(2000)
    })

    it('keeps the batch size fixed and independent of the buffer size', () => {
        // The buffer is a burst reservoir; the batch bounds each request. A large
        // buffer must not produce an oversized single POST.
        expect(resolveLogsConfig({ maxBufferSize: 5000 }).maxBatchRecordsPerPost).toBe(100)
        expect(resolveLogsConfig({ maxBufferSize: 25 }).maxBatchRecordsPerPost).toBe(100)
        // And a 0 buffer can't produce a zero-sized batch (which would spin the flush loop).
        expect(resolveLogsConfig({ maxBufferSize: 0 }).maxBatchRecordsPerPost).toBe(100)
    })

    it('couples the rate-cap window to the flush interval', () => {
        expect(resolveLogsConfig({ flushIntervalMs: 7000 }).rateCapWindowMs).toBe(7000)
    })

    it('lets resourceAttributes override the named service fields', () => {
        const resolved = resolveLogsConfig({
            serviceName: 'from-named',
            serviceVersion: 'from-named-version',
            environment: 'from-named-env',
            resourceAttributes: {
                'service.name': 'from-resource-attrs',
                'service.version': 'from-resource-version',
                'deployment.environment': 'from-resource-env',
            },
        })

        expect(resolved.serviceName).toBe('from-resource-attrs')
        expect(resolved.serviceVersion).toBe('from-resource-version')
        expect(resolved.environment).toBe('from-resource-env')
    })

    it('falls back to named fields when resourceAttributes omit them', () => {
        const resolved = resolveLogsConfig({
            serviceName: 'from-named',
            resourceAttributes: { 'host.name': 'web-01' },
        })

        expect(resolved.serviceName).toBe('from-named')
    })
})
