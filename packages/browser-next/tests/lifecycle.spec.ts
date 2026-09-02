import { analytics } from '../src/analytics'
import { createPostHog, type BrowserFetch } from '../src/core'

interface MutableNavigator {
    onLine: boolean
}

describe('browser-next analytics lifecycle', () => {
    const descriptors = new Map<PropertyKey, PropertyDescriptor | undefined>()
    let events: EventTarget
    let add: jest.Mock
    let remove: jest.Mock

    beforeEach(() => {
        events = new EventTarget()
        add = jest.fn(events.addEventListener.bind(events))
        remove = jest.fn(events.removeEventListener.bind(events))
        for (const [key, value] of [
            ['addEventListener', add],
            ['removeEventListener', remove],
            ['onpagehide', null],
        ] as const) {
            descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
            Object.defineProperty(globalThis, key, { configurable: true, value, writable: true })
        }
    })

    afterEach(() => {
        jest.restoreAllMocks()
        for (const key of ['addEventListener', 'removeEventListener', 'onpagehide']) {
            const descriptor = descriptors.get(key)
            if (descriptor) {
                Object.defineProperty(globalThis, key, descriptor)
            } else {
                delete (globalThis as Record<string, unknown>)[key]
            }
        }
        descriptors.clear()
        jest.useRealTimers()
    })

    it('initiates an uncompressed headered keepalive request synchronously on pagehide', async () => {
        const fetch = jest
            .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
            .mockResolvedValue(new Response('{}', { status: 200 }))
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: { onLine: true },
            fetch,
            extensions: [analytics({ flushAt: 100, flushInterval: 0 })],
        })
        await posthog.capture('first', { value: 'one' }, { uuid: 'first-uuid' })
        await posthog.capture('second', { value: 'two' }, { uuid: 'second-uuid' })
        expect(fetch).not.toHaveBeenCalled()

        events.dispatchEvent(new Event('pagehide'))

        expect(fetch).toHaveBeenCalledTimes(1)
        const [url, init] = fetch.mock.calls[0]!
        expect(String(url)).toBe('https://us.i.posthog.com/i/v1/analytics/events')
        expect(init).toMatchObject({ method: 'POST', credentials: 'omit', keepalive: true })
        expect(init?.headers).toMatchObject({
            'Content-Type': 'application/json',
            Authorization: 'Bearer ph_test',
            'PostHog-Sdk-Info': expect.stringMatching(/^posthog-js\//),
            'PostHog-Attempt': '1',
            'PostHog-Request-Id': expect.any(String),
            'PostHog-Request-Timestamp': expect.any(String),
        })
        expect(init?.headers).not.toHaveProperty('Content-Encoding')
        const body = JSON.parse(String(init?.body)) as { batch: Array<{ event: string; uuid: string }> }
        expect(body.batch.map(({ event, uuid }) => [event, uuid])).toEqual([
            ['first', 'first-uuid'],
            ['second', 'second-uuid'],
        ])

        posthog.optOut()
        await posthog.dispose()
        expect(remove.mock.calls.map(([event]) => event)).toEqual(
            expect.arrayContaining(['online', 'offline', 'pagehide'])
        )
    })

    it('includes active and queued source identities in teardown handoff', async () => {
        const requests: RequestInit[] = []
        const fetch: BrowserFetch = async (_input, init = {}) => {
            requests.push(init)
            if (requests.length === 1) {
                return new Promise(() => {})
            }
            return new Response('{}', { status: 200 })
        }
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: { onLine: true },
            fetch,
            extensions: [analytics({ flushAt: 1, flushInterval: 0 })],
        })
        await posthog.capture('active', undefined, { uuid: 'active-uuid' })
        await Promise.resolve()
        await posthog.capture('queued', undefined, { uuid: 'queued-uuid' })

        events.dispatchEvent(new Event('pagehide'))

        expect(requests).toHaveLength(2)
        expect(requests[0]?.keepalive).toBeUndefined()
        expect(requests[1]?.keepalive).toBe(true)
        const teardown = JSON.parse(String(requests[1]?.body)) as { batch: Array<{ uuid: string }> }
        expect(teardown.batch.map(({ uuid }) => uuid)).toEqual(['active-uuid', 'queued-uuid'])
        posthog.optOut()
        await posthog.dispose()
    })

    it('uses unload only when pagehide is unavailable', async () => {
        delete (globalThis as Record<string, unknown>).onpagehide
        const fetch = jest
            .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
            .mockResolvedValue(new Response('{}', { status: 200 }))
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: { onLine: true },
            fetch,
            extensions: [analytics({ flushAt: 100, flushInterval: 0 })],
        })
        await posthog.capture('queued')

        events.dispatchEvent(new Event('pagehide'))
        expect(fetch).not.toHaveBeenCalled()
        events.dispatchEvent(new Event('unload'))
        expect(fetch).toHaveBeenCalledTimes(1)

        posthog.optOut()
        await posthog.dispose()
    })

    it('retains work while offline and redrives it once when online fires', async () => {
        const navigator: MutableNavigator = { onLine: false }
        const fetch = jest
            .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
            .mockResolvedValue(new Response('{}', { status: 200 }))
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator,
            fetch,
            extensions: [analytics({ flushAt: 1, flushInterval: 10 })],
        })

        await posthog.capture('offline')
        await Promise.resolve()
        expect(fetch).not.toHaveBeenCalled()

        navigator.onLine = true
        events.dispatchEvent(new Event('online'))
        await Promise.resolve()
        await Promise.resolve()
        expect(fetch).toHaveBeenCalledTimes(1)

        events.dispatchEvent(new Event('online'))
        await Promise.resolve()
        expect(fetch).toHaveBeenCalledTimes(1)
        await posthog.dispose()
    })

    it('does not lose a staged batch when the browser goes offline before delivery starts', async () => {
        const navigator: MutableNavigator = { onLine: true }
        const fetch = jest
            .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
            .mockResolvedValue(new Response('{}', { status: 200 }))
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator,
            fetch,
            extensions: [analytics({ flushAt: 1, flushInterval: 0 })],
        })

        posthog.capture('staged')
        navigator.onLine = false
        events.dispatchEvent(new Event('offline'))
        await Promise.resolve()
        expect(fetch).not.toHaveBeenCalled()

        navigator.onLine = true
        events.dispatchEvent(new Event('online'))
        await posthog.flush()
        expect(fetch).toHaveBeenCalledTimes(1)
        await posthog.dispose()
    })

    it('removes analytics lifecycle callbacks even when another extension cleanup stalls', async () => {
        jest.useFakeTimers()
        const fetch = jest
            .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
            .mockResolvedValue(new Response('{}', { status: 200 }))
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: { onLine: true },
            fetch,
            extensions: [
                analytics({ flushAt: 100, flushInterval: 0 }),
                { name: 'stalled-cleanup', setup() {}, dispose: () => new Promise(() => {}) },
            ],
        })
        await posthog.capture('shutdown')

        const shutdown = posthog.shutdown(5)
        await jest.advanceTimersByTimeAsync(5)
        await shutdown
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(remove.mock.calls.map(([event]) => event)).toEqual(
            expect.arrayContaining(['online', 'offline', 'pagehide'])
        )

        events.dispatchEvent(new Event('pagehide'))
        expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('preserves FIFO by stopping at an over-budget teardown head', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        const fetch = jest
            .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
            .mockResolvedValue(new Response('{}', { status: 200 }))
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: { onLine: true },
            fetch,
            debug: true,
            extensions: [analytics({ flushAt: 100, flushInterval: 0 })],
        })
        await posthog.capture('oversized_head', { value: 'x'.repeat(53_000) })
        await posthog.capture('small_tail')

        events.dispatchEvent(new Event('pagehide'))

        expect(fetch).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalledWith(
            '[PostHog]',
            'Analytics teardown skipped 2 events outside the keepalive budget'
        )
        posthog.optOut()
        await posthog.dispose()
    })

    it('keeps aggregate teardown bodies below the conservative shared quota', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        const bodies: string[] = []
        const fetch: BrowserFetch = async (_input, init = {}) => {
            bodies.push(String(init.body))
            return new Response('{}', { status: 200 })
        }
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: { onLine: true },
            fetch,
            debug: true,
            extensions: [analytics({ flushAt: 100, flushInterval: 0 })],
        })
        await posthog.capture('first', { value: 'é'.repeat(15_000) })
        await posthog.capture('second', { value: 'é'.repeat(15_000) })

        events.dispatchEvent(new Event('pagehide'))

        expect(bodies).toHaveLength(1)
        expect(new TextEncoder().encode(bodies[0]).byteLength).toBeLessThanOrEqual(Math.floor(64 * 1024 * 0.8))
        expect((JSON.parse(bodies[0]!) as { batch: Array<{ event: string }> }).batch.map(({ event }) => event)).toEqual(
            ['first']
        )
        expect(warn).toHaveBeenCalledWith(
            '[PostHog]',
            'Analytics teardown skipped 1 event outside the keepalive budget'
        )

        posthog.optOut()
        await posthog.dispose()
    })
})
