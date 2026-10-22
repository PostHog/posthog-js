import { localRemoteConfig } from './helpers'
import { analytics } from '../src/analytics'
import { createAnalyticsExtension } from '../src/analytics-buffer'
import { createAnalyticsDelivery } from '../src/analytics-delivery'
import { Analytics, type AnalyticsDeliveryFactory } from '../src/analytics-internal'
import { createPostHog, type BrowserFetch } from '../src/core'
import { MemoryStorage } from './helpers'

const deferred = <T>() => {
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return { promise, resolve, reject }
}

describe('@posthog/browser public lifecycle state machine', () => {
    afterEach(() => {
        vi.restoreAllMocks()
        vi.useRealTimers()
    })

    it('keeps public mutations inert while closing and after disposal, and joins mixed lifecycle calls', async () => {
        const storage = new MemoryStorage()
        const response = deferred<Response>()
        const bodies: Array<{ batch?: Array<{ event?: string }> }> = []
        const fetch = vi.fn<Parameters<BrowserFetch>, ReturnType<BrowserFetch>>((_input, init = {}) => {
            bodies.push(JSON.parse(String(init.body)) as { batch?: Array<{ event?: string }> })
            return response.promise
        })
        const cleanup = vi.fn(async () => {})
        const posthog = await createPostHog({
            remoteConfig: localRemoteConfig,
            projectToken: 'ph_test',
            capturePageview: false,
            storage,
            navigator: false,
            fetch,
            extensions: [
                analytics({ flushAt: 100, flushInterval: 0 }),
                { name: 'cleanup-observer', setup() {}, dispose: cleanup },
            ],
        })
        const observed: string[] = []
        posthog.onEvent(({ event }) => observed.push(event))
        await posthog.identify('baseline-user')
        await posthog.group('company', 'baseline-company')
        await posthog.capture('baseline-event')
        expect(observed).toEqual(['$identify', '$groupidentify', 'baseline-event'])
        observed.length = 0

        const shutdown = posthog.shutdown()
        const dispose: Promise<void> = posthog.dispose()
        const repeatedShutdown = posthog.shutdown(0)
        let concurrentFlushSettled = false
        const concurrentFlush = posthog.flush().then(() => {
            concurrentFlushSettled = true
        })
        expect(dispose).toBe(shutdown)
        expect(repeatedShutdown).toBe(shutdown)

        posthog.reset()
        posthog.capture('closing-capture')
        await Promise.all([posthog.identify('closing-user'), posthog.group('company', 'closing-company')])
        expect(observed).toEqual([])

        await Promise.resolve()
        await Promise.resolve()
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(concurrentFlushSettled).toBe(false)
        response.resolve(new Response('{}', { status: 200 }))
        await Promise.all([shutdown, concurrentFlush])
        expect(concurrentFlushSettled).toBe(true)
        expect(cleanup).toHaveBeenCalledTimes(1)

        posthog.reset()
        posthog.capture('disposed-capture')
        await Promise.all([
            posthog.identify('disposed-user'),
            posthog.group('company', 'disposed-company'),
            posthog.flush(),
        ])
        expect(posthog.shutdown()).toBe(shutdown)
        expect(posthog.dispose()).toBe(shutdown)
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(bodies[0]?.batch?.map(({ event }) => event)).toEqual(['$identify', '$groupidentify', 'baseline-event'])

        const reloaded = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage,
            navigator: false,
            fetch: false,
        })
        expect(reloaded.distinctId).toBe('baseline-user')
        expect(reloaded.groups).toEqual({ company: 'baseline-company' })
        await reloaded.shutdown()
    })

    it('leaves late-loaded delivery inert after shutdown', async () => {
        vi.useFakeTimers()
        const loaded = deferred<AnalyticsDeliveryFactory>()
        const load = vi.fn(() => loaded.promise)
        const fetch = vi
            .fn<Parameters<BrowserFetch>, ReturnType<BrowserFetch>>()
            .mockResolvedValue(new Response('{}', { status: 200 }))
        const createDelivery = vi.fn(createAnalyticsDelivery)
        const posthog = await createPostHog({
            remoteConfig: localRemoteConfig,
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: false,
            fetch,
            extensions: [createAnalyticsExtension({ load: 'lazy' }, load)],
        })
        const dispose = vi.spyOn(posthog.getExtension(Analytics)!, 'dispose')
        await posthog.capture('pending-import')
        await Promise.resolve()
        expect(load).toHaveBeenCalledTimes(1)

        const shutdown = posthog.shutdown(5)
        await vi.advanceTimersByTimeAsync(5)
        await shutdown

        loaded.resolve(createDelivery)
        await vi.advanceTimersByTimeAsync(0)
        expect(createDelivery).not.toHaveBeenCalled()
        expect(dispose).toHaveBeenCalledTimes(1)
        expect(posthog.getExtension('analytics')).toBeUndefined()
        expect(fetch).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('cancels a real retry timer when bounded shutdown expires', async () => {
        vi.useFakeTimers()
        const fetch = vi
            .fn<Parameters<BrowserFetch>, ReturnType<BrowserFetch>>()
            .mockResolvedValue(new Response('{}', { status: 503 }))
        const posthog = await createPostHog({
            remoteConfig: localRemoteConfig,
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: false,
            fetch,
            extensions: [analytics({ flushAt: 1, flushInterval: 0 })],
        })
        await posthog.capture('retrying')
        await vi.advanceTimersByTimeAsync(0)
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBeGreaterThan(0)

        const shutdown = posthog.shutdown(5)
        await vi.advanceTimersByTimeAsync(5)
        await shutdown
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(0)

        await vi.advanceTimersByTimeAsync(60_000)
        expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('contains extension cleanup rejection and still cleans every extension once', async () => {
        const first = vi.fn(async () => {})
        const failing = vi.fn(async () => {
            throw new Error('cleanup failed')
        })
        const last = vi.fn(async () => {})
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: false,
            fetch: false,
            extensions: [
                { name: 'first', setup() {}, dispose: first },
                { name: 'failing', setup() {}, dispose: failing },
                { name: 'last', setup() {}, dispose: last },
            ],
        })

        await expect(posthog.shutdown()).resolves.toBeUndefined()
        expect(first).toHaveBeenCalledTimes(1)
        expect(failing).toHaveBeenCalledTimes(1)
        expect(last).toHaveBeenCalledTimes(1)
        await expect(posthog.dispose()).resolves.toBeUndefined()
        expect(first).toHaveBeenCalledTimes(1)
        expect(failing).toHaveBeenCalledTimes(1)
        expect(last).toHaveBeenCalledTimes(1)
    })
})
