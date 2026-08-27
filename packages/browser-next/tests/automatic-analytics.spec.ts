import { analytics } from '../src/analytics'
import { createPostHog } from '../src'
import { createPostHogCore, type AutomaticAnalyticsSetup } from '../src/posthog'
import type { AnalyticsOptions, Extension, LoadStrategy } from '../src/types'
import { createFetch, type SentRequest } from './helpers'

const automaticSetup = (
    load: (options: AnalyticsOptions) => Promise<Extension>,
    options: AnalyticsOptions = {},
    strategy: LoadStrategy = 'lazy'
): AutomaticAnalyticsSetup => ({ strategy, options, load })

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
        await posthog.shutdown()
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

    it('keeps the core buffer manual when automatic analytics is disabled', async () => {
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
        const load = jest.fn(async () => analytics({ flushAt: 1, flushInterval: 0 }))
        const posthog = await createPostHogCore(
            {
                projectToken: 'ph_test',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch: createFetch(requests),
                extensions: [analytics({ flushAt: 2, flushInterval: 0 })],
            },
            automaticSetup(load)
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
        const eagerLoad = jest.fn(async () => analytics())
        const lazyLoad = jest.fn(async () => analytics())
        const denied = await createPostHogCore(
            {
                projectToken: 'ph_test_denied',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch: false,
                optOutByDefault: true,
            },
            automaticSetup(eagerLoad, {}, 'eager')
        )
        await denied.capture('denied')

        const bot = await createPostHogCore(
            {
                projectToken: 'ph_test_bot',
                capturePageview: false,
                storage: false,
                navigator: { webdriver: true },
                fetch: false,
            },
            automaticSetup(lazyLoad)
        )
        await bot.capture('bot')

        const rejected = await createPostHogCore(
            {
                projectToken: 'ph_test_rejected',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch: false,
            },
            automaticSetup(lazyLoad)
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
        const extension = deferred<Extension>()
        const load = jest.fn(() => extension.promise)
        const posthog = await createPostHogCore(
            {
                projectToken: 'ph_test',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch: createFetch(requests),
            },
            automaticSetup(load, { flushAt: 100, flushInterval: 0 })
        )

        await Promise.all([posthog.capture('one'), posthog.capture('two'), posthog.capture('three')])
        await Promise.resolve()
        expect(load).toHaveBeenCalledTimes(1)

        extension.resolve(analytics({ flushAt: 100, flushInterval: 0 }))
        await posthog.flush()
        expect(requests).toHaveLength(1)
        expect((requests[0]?.body?.batch as unknown[]) ?? []).toHaveLength(3)
        await posthog.shutdown()
    })

    it('retains events after a load failure and retries loading on explicit flush', async () => {
        const requests: SentRequest[] = []
        const load = jest
            .fn<Promise<Extension>, [AnalyticsOptions]>()
            .mockRejectedValueOnce(new Error('chunk unavailable'))
            .mockResolvedValueOnce(analytics({ flushAt: 100, flushInterval: 0 }))
        const posthog = await createPostHogCore(
            {
                projectToken: 'ph_test',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch: createFetch(requests),
            },
            automaticSetup(load)
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
        const first = deferred<Extension>()
        const retry = deferred<Extension>()
        const load = jest.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise)
        const posthog = await createPostHogCore(
            {
                projectToken: 'ph_test',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch: createFetch(requests),
            },
            automaticSetup(load)
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

        retry.resolve(analytics({ flushAt: 100, flushInterval: 0 }))
        await Promise.all([firstFlush, secondFlush])
        expect(requests).toHaveLength(1)
        await posthog.shutdown()
    })

    it('installs an in-flight analytics extension after revocation without sending purged work', async () => {
        const requests: SentRequest[] = []
        const extension = deferred<Extension>()
        const load = jest.fn(() => extension.promise)
        const posthog = await createPostHogCore(
            {
                projectToken: 'ph_test',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch: createFetch(requests),
            },
            automaticSetup(load)
        )

        await posthog.capture('purged')
        await Promise.resolve()
        posthog.optOut()
        extension.resolve(analytics())
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
        const extension = deferred<Extension>()
        const posthog = await createPostHogCore(
            {
                projectToken: 'ph_test',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch: createFetch(requests),
            },
            automaticSetup(() => extension.promise)
        )
        await posthog.capture('shutdown_load')

        const shutdown = posthog.shutdown(1_000)
        extension.resolve(analytics({ flushAt: 100, flushInterval: 0 }))
        await shutdown

        expect(requests).toHaveLength(1)
    })

    it('disposes an automatic extension once when shutdown wins asynchronous setup', async () => {
        jest.useFakeTimers()
        try {
            const setupStarted = deferred<void>()
            const releaseSetup = deferred<void>()
            const extension = analytics()
            const setup = extension.setup.bind(extension)
            const disposeExtension = extension.dispose?.bind(extension)
            const dispose = jest.fn(() => disposeExtension?.())
            extension.setup = async (client) => {
                setupStarted.resolve()
                await releaseSetup.promise
                if (dispose.mock.calls.length === 0) {
                    await setup(client)
                }
            }
            extension.dispose = dispose
            const posthog = await createPostHogCore(
                {
                    projectToken: 'ph_test',
                    capturePageview: false,
                    storage: false,
                    navigator: false,
                    fetch: false,
                },
                automaticSetup(async () => extension)
            )
            await posthog.capture('pending_setup')
            await setupStarted.promise

            const shutdown = posthog.shutdown(5)
            await jest.advanceTimersByTimeAsync(5)
            await shutdown

            expect(dispose).toHaveBeenCalledTimes(1)
            expect(posthog.getExtension('analytics')).toBeUndefined()
            releaseSetup.resolve()
            await Promise.resolve()
            await Promise.resolve()
            expect(dispose).toHaveBeenCalledTimes(1)
        } finally {
            jest.useRealTimers()
        }
    })

    it('bounds shutdown while an automatic import remains pending', async () => {
        jest.useFakeTimers()
        try {
            const load = jest.fn(() => new Promise<Extension>(() => {}))
            const posthog = await createPostHogCore(
                {
                    projectToken: 'ph_test',
                    capturePageview: false,
                    storage: false,
                    navigator: false,
                    fetch: false,
                },
                automaticSetup(load)
            )
            await posthog.capture('pending')

            const shutdown = posthog.shutdown(5)
            await jest.advanceTimersByTimeAsync(5)
            await shutdown

            expect(load).toHaveBeenCalledTimes(1)
        } finally {
            jest.useRealTimers()
        }
    })
})
