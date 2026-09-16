import { analytics } from '../src/analytics'
import { createAnalyticsExtension } from '../src/analytics-buffer'
import { createAnalyticsDelivery } from '../src/analytics-delivery'
import { isAnalyticsExtension, type AnalyticsDeliveryFactory, type AnalyticsExtension } from '../src/analytics-internal'
import { createPostHog } from '../src'
import { createPostHog as createCorePostHog } from '../src/core'
import type { AutomaticAnalyticsOptions, CorePostHogOptions, PostHog } from '../src/types'
import { createFetch, type SentRequest } from './helpers'

const automaticAnalytics = (
    load: () => Promise<AnalyticsDeliveryFactory>,
    options: AutomaticAnalyticsOptions = { flushAt: 100, flushInterval: 0 }
): AnalyticsExtension => createAnalyticsExtension(options, load)

const createWithAnalytics = (options: CorePostHogOptions, extension?: AnalyticsExtension): Promise<PostHog> => {
    const configured = options.extensions ?? []
    const extensions = extension && !configured.some(isAnalyticsExtension) ? [extension, ...configured] : configured
    return createCorePostHog({ ...options, extensions })
}

const deferred = <T>() => {
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return { promise, resolve, reject }
}

describe('@posthog/browser automatic analytics', () => {
    it('keeps the same analytics instance and finalized events while delivery loads', async () => {
        const requests: SentRequest[] = []
        const imported = deferred<AnalyticsDeliveryFactory>()
        const load = vi.fn(() => imported.promise)
        const posthog = await createWithAnalytics(
            {
                projectToken: 'ph_test',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch: createFetch(requests),
            },
            automaticAnalytics(load)
        )
        const extension = posthog.getExtension('analytics')
        const observed = vi.fn()
        const property = vi.fn(() => 'original')
        posthog.onEvent(observed)
        expect(extension).toBeDefined()
        expect(load).not.toHaveBeenCalled()
        const timestamp = new Date('2026-01-01T00:00:00.000Z')
        posthog.capture(
            'before-load',
            {
                get value() {
                    return property()
                },
            },
            { uuid: 'stable-uuid', timestamp }
        )
        const originalIdentity = posthog.distinctId
        const originalSession = posthog.session.sessionId
        await posthog.identify('identified-later')
        expect(requests).toHaveLength(0)
        imported.resolve(createAnalyticsDelivery)
        await posthog.flush()
        expect(posthog.getExtension('analytics')).toBe(extension)
        expect(load).toHaveBeenCalledTimes(1)
        expect(property).toHaveBeenCalledTimes(1)
        expect(observed.mock.calls.map(([event]) => event.event)).toEqual(['before-load', '$identify'])
        expect((requests[0]?.body?.batch as Array<Record<string, unknown>>)[0]).toMatchObject({
            event: 'before-load',
            uuid: 'stable-uuid',
            timestamp: timestamp.toISOString(),
            distinct_id: originalIdentity,
            session_id: originalSession,
            properties: { value: 'original' },
        })
        posthog.capture('after-load')
        await posthog.flush()
        expect(posthog.getExtension('analytics')).toBe(extension)
        expect(load).toHaveBeenCalledTimes(1)
        await posthog.shutdown()
    })

    it('shares loading between flush and immediate capture without reviving revoked immediate work', async () => {
        const requests: SentRequest[] = []
        const imported = deferred<AnalyticsDeliveryFactory>()
        const load = vi.fn(() => imported.promise)
        const posthog = await createWithAnalytics(
            {
                projectToken: 'ph_test',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch: createFetch(requests),
            },
            automaticAnalytics(load)
        )
        const immediate = posthog.captureImmediate('before-denial')
        const cancelled = expect(immediate).resolves.toMatchObject({
            submitted: 0,
            notPersisted: 0,
            allPersisted: false,
            error: { message: 'Immediate analytics delivery was cancelled' },
        })
        posthog.optOut()
        posthog.optIn()
        posthog.capture('after-grant')
        const flush = posthog.flush()
        imported.resolve(createAnalyticsDelivery)
        await Promise.all([cancelled, flush])
        expect(load).toHaveBeenCalledTimes(1)
        expect(requests).toHaveLength(1)
        expect((requests[0]?.body?.batch as Array<{ event: string }>).map(({ event }) => event)).toEqual([
            'after-grant',
        ])
        await posthog.shutdown()
    })

    it('expires preload work using its original admission time before attaching delivery', async () => {
        vi.useFakeTimers()
        try {
            const requests: SentRequest[] = []
            const imported = deferred<AnalyticsDeliveryFactory>()
            const posthog = await createWithAnalytics(
                {
                    projectToken: 'ph_test',
                    capturePageview: false,
                    storage: false,
                    navigator: false,
                    fetch: createFetch(requests),
                },
                automaticAnalytics(() => imported.promise)
            )
            const extension = posthog.getExtension('analytics')
            posthog.capture('expired')
            await Promise.resolve()
            expect(vi.getTimerCount()).toBe(0)
            await vi.advanceTimersByTimeAsync(60 * 60 * 1_000 + 1)
            posthog.capture('fresh')
            const flush = posthog.flush()
            imported.resolve(createAnalyticsDelivery)
            await flush
            expect(posthog.getExtension('analytics')).toBe(extension)
            expect((requests[0]?.body?.batch as Array<{ event: string }>).map(({ event }) => event)).toEqual(['fresh'])
            await posthog.shutdown()
            expect(vi.getTimerCount()).toBe(0)
        } finally {
            vi.useRealTimers()
        }
    })

    it('makes explicitly supplied analytics available to earlier configured extensions', async () => {
        const requests: SentRequest[] = []
        const extension = analytics({ flushAt: 100, flushInterval: 0 })
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
            extensions: [
                {
                    name: 'captures-during-setup',
                    setup(client) {
                        expect(client.getExtension('analytics')).toBe(extension)
                        client.capture('during-setup')
                    },
                },
                extension,
            ],
        })
        await posthog.flush()
        expect((requests[0]?.body?.batch as Array<{ event: string }>)[0]?.event).toBe('during-setup')
        expect(posthog.getExtension('analytics')).toBe(extension)
        await posthog.shutdown()
    })

    it('loads analytics after the first admitted event and flushes it', async () => {
        const requests: SentRequest[] = []
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })

        await posthog.capture('automatic')
        await posthog.flush()

        expect(requests).toHaveLength(1)
        expect((requests[0]?.body?.batch as Array<{ event: string }> | undefined)?.[0]?.event).toBe('automatic')
        const disposal: Promise<void> = posthog.dispose()
        await disposal
    })

    it('passes a stable snapshot of root scheduling options to the analytics constructor', async () => {
        const requests: SentRequest[] = []
        const configuration = { flushAt: 1, flushInterval: 0 }
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
            analytics: configuration,
        })
        configuration.flushAt = 100
        configuration.flushInterval = 60_000

        await posthog.capture('snapshotted')
        await new Promise((resolve) => globalThis.setTimeout(resolve, 0))

        expect(requests).toHaveLength(1)
        await posthog.shutdown()
    })

    it('supports eager loading through the same root configuration', async () => {
        const requests: SentRequest[] = []
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
            analytics: { load: 'eager', flushAt: 1, flushInterval: 0 },
        })

        expect(posthog.getExtension('analytics')).toBeDefined()
        await posthog.capture('eager')
        await posthog.flush()
        expect(requests).toHaveLength(1)
        await posthog.shutdown()
    })

    it('loads analytics for the admitted default pageview', async () => {
        const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: { visibilityState: 'visible' },
        })
        try {
            const requests: SentRequest[] = []
            const posthog = await createPostHog({
                projectToken: 'ph_test',
                storage: false,
                navigator: false,
                fetch: createFetch(requests),
            })

            await posthog.flush()

            expect((requests[0]?.body?.batch as Array<{ event: string }> | undefined)?.[0]?.event).toBe('$pageview')
            await posthog.shutdown()
        } finally {
            if (originalDocument) {
                Object.defineProperty(globalThis, 'document', originalDocument)
            } else {
                delete (globalThis as Record<string, unknown>).document
            }
        }
    })

    it('retains analytics buffering without delivery when automatic loading is disabled', async () => {
        const requests: SentRequest[] = []
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
            analytics: false,
        })

        await posthog.capture('buffered')
        await posthog.flush()

        expect(requests).toHaveLength(0)
        await posthog.shutdown()
    })

    it('lets an explicit analytics extension own delivery without loading a duplicate', async () => {
        const requests: SentRequest[] = []
        const load = vi.fn(async () => createAnalyticsDelivery)
        const posthog = await createWithAnalytics(
            {
                projectToken: 'ph_test',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch: createFetch(requests),
                extensions: [analytics({ flushAt: 2, flushInterval: 0 })],
            },
            automaticAnalytics(load)
        )

        await posthog.capture('first')
        expect(requests).toHaveLength(0)
        await posthog.capture('second')
        await posthog.flush()

        expect(load).not.toHaveBeenCalled()
        expect(requests).toHaveLength(1)
        expect((requests[0]?.body?.batch as unknown[]) ?? []).toHaveLength(2)
        await posthog.shutdown()
    })

    it('loads eager analytics under denial but does not lazy-load for rejected capture', async () => {
        const eagerLoad = vi.fn(async () => createAnalyticsDelivery)
        const lazyLoad = vi.fn(async () => createAnalyticsDelivery)
        const denied = await createWithAnalytics(
            {
                projectToken: 'ph_test_denied',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch: false,
                optOutByDefault: true,
            },
            automaticAnalytics(eagerLoad, { load: 'eager' })
        )
        await denied.capture('denied')

        const bot = await createWithAnalytics(
            {
                projectToken: 'ph_test_bot',
                capturePageview: false,
                storage: false,
                navigator: { webdriver: true },
                fetch: false,
            },
            automaticAnalytics(lazyLoad)
        )
        await bot.capture('bot')

        const rejected = await createWithAnalytics(
            {
                projectToken: 'ph_test_rejected',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch: false,
            },
            automaticAnalytics(lazyLoad)
        )
        const circular: Record<string, unknown> = {}
        circular.circular = circular
        await rejected.capture('rejected', circular)

        expect(eagerLoad).toHaveBeenCalledTimes(1)
        expect(lazyLoad).not.toHaveBeenCalled()
        await Promise.all([denied.shutdown(), bot.shutdown(), rejected.shutdown()])
    })

    it('shares one load across concurrent captures', async () => {
        const requests: SentRequest[] = []
        const extension = deferred<AnalyticsDeliveryFactory>()
        const load = vi.fn(() => extension.promise)
        const posthog = await createWithAnalytics(
            {
                projectToken: 'ph_test',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch: createFetch(requests),
            },
            automaticAnalytics(load, { flushAt: 100, flushInterval: 0 })
        )

        posthog.capture('one')
        posthog.capture('two')
        posthog.capture('three')
        expect(load).not.toHaveBeenCalled()
        await Promise.resolve()
        expect(load).toHaveBeenCalledTimes(1)

        extension.resolve(createAnalyticsDelivery)
        await posthog.flush()
        expect(requests).toHaveLength(1)
        expect((requests[0]?.body?.batch as unknown[]) ?? []).toHaveLength(3)
        await posthog.shutdown()
    })

    it.each(['throw', 'reject'] as const)('retains events after a load %s and retries on flush', async (failure) => {
        const requests: SentRequest[] = []
        const load = vi
            .fn<[], Promise<AnalyticsDeliveryFactory>>()
            .mockImplementationOnce(() => {
                const error = new Error('chunk unavailable')
                if (failure === 'throw') {
                    throw error
                }
                return Promise.reject(error)
            })
            .mockResolvedValueOnce(createAnalyticsDelivery)
        const posthog = await createWithAnalytics(
            {
                projectToken: 'ph_test',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch: createFetch(requests),
            },
            automaticAnalytics(load)
        )

        await posthog.capture('retained_one')
        await Promise.resolve()
        await Promise.resolve()
        await posthog.capture('retained_two')
        expect(load).toHaveBeenCalledTimes(1)

        await posthog.flush()

        expect(load).toHaveBeenCalledTimes(2)
        expect(requests).toHaveLength(1)
        expect((requests[0]?.body?.batch as unknown[]) ?? []).toHaveLength(2)
        await posthog.shutdown()
    })

    it('keeps concurrent flush callers joined through a failed load and shared retry', async () => {
        const requests: SentRequest[] = []
        const first = deferred<AnalyticsDeliveryFactory>()
        const retry = deferred<AnalyticsDeliveryFactory>()
        const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise)
        const posthog = await createWithAnalytics(
            {
                projectToken: 'ph_test',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch: createFetch(requests),
            },
            automaticAnalytics(load)
        )
        await posthog.capture('concurrent_flush')
        await Promise.resolve()

        let firstSettled = false
        let secondSettled = false
        const firstFlush = posthog.flush().then(() => {
            firstSettled = true
        })
        const secondFlush = posthog.flush().then(() => {
            secondSettled = true
        })
        first.reject(new Error('first load failed'))
        await new Promise((resolve) => globalThis.setTimeout(resolve, 0))

        expect(load).toHaveBeenCalledTimes(2)
        expect(firstSettled).toBe(false)
        expect(secondSettled).toBe(false)

        retry.resolve(createAnalyticsDelivery)
        await Promise.all([firstFlush, secondFlush])
        expect(requests).toHaveLength(1)
        await posthog.shutdown()
    })

    it('finishes loading delivery after revocation without sending purged work', async () => {
        const requests: SentRequest[] = []
        const extension = deferred<AnalyticsDeliveryFactory>()
        const load = vi.fn(() => extension.promise)
        const posthog = await createWithAnalytics(
            {
                projectToken: 'ph_test',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch: createFetch(requests),
            },
            automaticAnalytics(load)
        )

        await posthog.capture('purged')
        await Promise.resolve()
        posthog.optOut()
        extension.resolve(createAnalyticsDelivery)
        await Promise.resolve()
        await Promise.resolve()
        await posthog.flush()

        expect(requests).toHaveLength(0)
        expect(posthog.getExtension('analytics')).toBeDefined()

        posthog.optIn()
        await posthog.capture('after-grant')
        await posthog.flush()
        expect(requests).toHaveLength(1)
        expect((requests[0]?.body?.batch as Array<{ event: string }>)[0]?.event).toBe('after-grant')
        await posthog.shutdown()
    })

    it('waits for an in-progress automatic load and flushes within shutdown', async () => {
        const requests: SentRequest[] = []
        const extension = deferred<AnalyticsDeliveryFactory>()
        const posthog = await createWithAnalytics(
            {
                projectToken: 'ph_test',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch: createFetch(requests),
            },
            automaticAnalytics(() => extension.promise)
        )
        await posthog.capture('shutdown_load')

        const shutdown = posthog.shutdown(1_000)
        extension.resolve(createAnalyticsDelivery)
        await shutdown

        expect(requests).toHaveLength(1)
    })

    it('disposes analytics once and never starts delivery when shutdown wins the import', async () => {
        vi.useFakeTimers()
        try {
            const imported = deferred<AnalyticsDeliveryFactory>()
            const createDelivery = vi.fn(createAnalyticsDelivery)
            const extension = automaticAnalytics(() => imported.promise, {})
            const dispose = vi.spyOn(extension, 'dispose')
            const setup = vi.spyOn(extension, 'setup')
            const posthog = await createWithAnalytics({
                projectToken: 'ph_test',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch: false,
                extensions: [extension],
            })
            posthog.capture('pending_import')
            const shutdown = posthog.shutdown(5)
            await vi.advanceTimersByTimeAsync(5)
            await shutdown
            expect(dispose).toHaveBeenCalledTimes(1)
            expect(posthog.getExtension('analytics')).toBeUndefined()
            imported.resolve(createDelivery)
            await vi.advanceTimersByTimeAsync(0)
            expect(createDelivery).not.toHaveBeenCalled()
            expect(setup).toHaveBeenCalledTimes(1)
            expect(dispose).toHaveBeenCalledTimes(1)
        } finally {
            vi.useRealTimers()
        }
    })

    it('bounds shutdown while an automatic import remains pending', async () => {
        vi.useFakeTimers()
        try {
            const load = vi.fn(() => new Promise<AnalyticsDeliveryFactory>(() => {}))
            const posthog = await createWithAnalytics(
                {
                    projectToken: 'ph_test',
                    capturePageview: false,
                    storage: false,
                    navigator: false,
                    fetch: false,
                },
                automaticAnalytics(load)
            )
            await posthog.capture('pending')

            const shutdown = posthog.shutdown(5)
            await vi.advanceTimersByTimeAsync(5)
            await shutdown

            expect(load).toHaveBeenCalledTimes(1)
        } finally {
            vi.useRealTimers()
        }
    })
})
