import { analytics } from '../src/analytics'
import { createPostHog, type BrowserFetch } from '../src/core'
import { createPostHogCore, type AutomaticAnalyticsSetup } from '../src/posthog'
import type { AnalyticsOptions, Extension } from '../src/types'
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

const automaticSetup = (load: (options: AnalyticsOptions) => Promise<Extension>): AutomaticAnalyticsSetup => ({
    strategy: 'lazy',
    options: {},
    load,
})

describe('@posthog/browser public lifecycle state machine', () => {
    afterEach(() => {
        jest.restoreAllMocks()
        jest.useRealTimers()
    })

    it('keeps public mutations inert while closing and after disposal, and joins mixed lifecycle calls', async () => {
        const storage = new MemoryStorage()
        const response = deferred<Response>()
        const bodies: Array<{ batch?: Array<{ event?: string }> }> = []
        const fetch = jest.fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>((_input, init = {}) => {
            bodies.push(JSON.parse(String(init.body)) as { batch?: Array<{ event?: string }> })
            return response.promise
        })
        const cleanup = jest.fn(async () => {})
        const posthog = await createPostHog({
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
        await Promise.all([
            posthog.capture('closing-capture'),
            posthog.identify('closing-user'),
            posthog.group('company', 'closing-company'),
        ])
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
        await Promise.all([
            posthog.capture('disposed-capture'),
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

    it('disposes a late automatic import without installing or sending after shutdown', async () => {
        jest.useFakeTimers()
        const loaded = deferred<Extension>()
        const load = jest.fn(() => loaded.promise)
        const fetch = jest
            .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
            .mockResolvedValue(new Response('{}', { status: 200 }))
        const extension = analytics({ flushAt: 1, flushInterval: 0 })
        const disposeExtension = extension.dispose?.bind(extension)
        const disposed = deferred<void>()
        const dispose = jest.fn(() => {
            disposed.resolve(undefined)
            return disposeExtension?.()
        })
        extension.dispose = dispose
        const posthog = await createPostHogCore(
            {
                projectToken: 'ph_test',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch,
            },
            automaticSetup(load)
        )
        await posthog.capture('pending-import')
        await Promise.resolve()
        expect(load).toHaveBeenCalledTimes(1)

        const shutdown = posthog.shutdown(5)
        await jest.advanceTimersByTimeAsync(5)
        await shutdown

        loaded.resolve(extension)
        await disposed.promise
        expect(dispose).toHaveBeenCalledTimes(1)
        expect(posthog.getExtension('analytics')).toBeUndefined()
        expect(fetch).not.toHaveBeenCalled()
        expect(jest.getTimerCount()).toBe(0)
    })

    it('cancels a real retry timer when bounded shutdown expires', async () => {
        jest.useFakeTimers()
        const fetch = jest
            .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
            .mockResolvedValue(new Response('{}', { status: 503 }))
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: false,
            fetch,
            extensions: [analytics({ flushAt: 1, flushInterval: 0 })],
        })
        await posthog.capture('retrying')
        await jest.advanceTimersByTimeAsync(0)
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(jest.getTimerCount()).toBeGreaterThan(0)

        const shutdown = posthog.shutdown(5)
        await jest.advanceTimersByTimeAsync(5)
        await shutdown
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(jest.getTimerCount()).toBe(0)

        await jest.advanceTimersByTimeAsync(60_000)
        expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('contains extension cleanup rejection and still cleans every extension once', async () => {
        const first = jest.fn(async () => {})
        const failing = jest.fn(async () => {
            throw new Error('cleanup failed')
        })
        const last = jest.fn(async () => {})
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
