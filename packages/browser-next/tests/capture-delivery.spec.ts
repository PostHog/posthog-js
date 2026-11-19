import { createPostHog as createDefault } from '../src/composition/npm/core'
import { analyticsOf } from '../src/products/analytics/analytics-of'
import type { BrowserFetch } from '../src/core/types'
import { recordCapture, recordingOptions, type RecordedRequest } from './capture-recorder'

const settle = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

const names = (requests: readonly RecordedRequest[]): string[][] =>
    requests.map((request) => request.batch.map((event) => event.event))

const stubWindowEvents = (): EventTarget => {
    const target = new EventTarget()
    vi.stubGlobal('addEventListener', target.addEventListener.bind(target))
    vi.stubGlobal('removeEventListener', target.removeEventListener.bind(target))
    vi.stubGlobal('onpagehide', null)
    return target
}

describe('immediate capture delivery', () => {
    it('starts delivery without waiting for the batch threshold or timer', async () => {
        const requests: RecordedRequest[] = []
        const posthog = await createDefault(recordingOptions(recordCapture(requests)))

        posthog.capture('queued')
        expect(posthog.capture('instant', { plan: 'pro' }, { delivery: 'immediate' })).toBe(true)
        await settle()

        expect(names(requests)).toEqual([['queued', 'instant']])
        expect(requests[0]?.keepalive).not.toBe(true)
        expect(requests[0]?.batch[1]?.properties).toMatchObject({ plan: 'pro' })
        await posthog.shutdown()
    })

    it('admits the event through ordinary capture observation', async () => {
        const posthog = await createDefault(recordingOptions(recordCapture([])))
        const observed: string[] = []
        posthog.onEvent(({ event }) => observed.push(event))

        posthog.capture('instant', null, { delivery: 'immediate' })

        expect(observed).toEqual(['instant'])
        await posthog.shutdown()
    })

    it('does not send an event captured after opt-out', async () => {
        const requests: RecordedRequest[] = []
        const posthog = await createDefault(recordingOptions(recordCapture(requests)))

        posthog.optOut()
        posthog.capture('instant', null, { delivery: 'immediate' })
        await settle()

        expect(requests).toEqual([])
        await posthog.shutdown()
    })
})

describe('immediate capture with default delivery', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('does not dispatch an event when a capture listener opts out, and opt-in does not revive it', async () => {
        const requests: RecordedRequest[] = []
        const posthog = await createDefault(recordingOptions(recordCapture(requests)))
        posthog.onEvent(({ event }) => {
            if (event === 'instant') posthog.optOut()
        })

        posthog.capture('instant', null, { delivery: 'immediate' })
        await settle()
        posthog.optIn()
        await posthog.flush()

        expect(requests).toEqual([])
        await posthog.shutdown()
    })

    it.each([
        ['retries a failed immediate event', false, 4],
        ['stops retrying an immediate event after opt-out, even after a later opt-in', true, 1],
    ])('%s', async (_name, optOut, expectedAttempts) => {
        vi.useFakeTimers()
        try {
            let attempts = 0
            const unavailable: BrowserFetch = async () => {
                attempts++
                return new Response('{}', { status: 503 })
            }
            const posthog = await createDefault(recordingOptions(unavailable))

            posthog.capture('instant', null, { delivery: 'immediate' })
            await vi.advanceTimersByTimeAsync(0)
            expect(attempts).toBe(1)
            if (optOut) {
                posthog.optOut()
                posthog.optIn()
            }
            await vi.advanceTimersByTimeAsync(120_000)

            expect(attempts).toBe(expectedAttempts)
            const shutdown = posthog.shutdown(0)
            await vi.runAllTimersAsync()
            await shutdown
        } finally {
            vi.useRealTimers()
        }
    })

    // The sender makes four attempts per drain; with no flush timer, a failed batch then waits for a later trigger.
    it.each([
        ['attempts the event after an earlier batch exhausts its retries', 4, [['earlier', 'instant']]],
        [
            'makes one more drain, not an endless retry, while delivery keeps failing',
            Infinity,
            Array(4).fill(['earlier', 'instant']),
        ],
    ])('%s', async (_name, failures, afterEarlierBatch) => {
        vi.useFakeTimers()
        try {
            const attempts: string[][] = []
            const fetch: BrowserFetch = async (_input, init) => {
                const batch = (JSON.parse(String(init?.body)) as { batch: { event: string; uuid: string }[] }).batch
                attempts.push(batch.map((event) => event.event))
                if (attempts.length <= failures) return new Response('{}', { status: 503 })
                const results = Object.fromEntries(batch.map((event) => [event.uuid, { result: 'ok' }]))
                return new Response(JSON.stringify({ results }), { status: 200 })
            }
            const posthog = await createDefault(recordingOptions(fetch))

            posthog.capture('earlier')
            void posthog.flush()
            await vi.advanceTimersByTimeAsync(0)
            posthog.capture('instant', null, { delivery: 'immediate' })
            await vi.advanceTimersByTimeAsync(300_000)

            expect(attempts).toEqual([...Array(4).fill(['earlier']), ...afterEarlierBatch])
            const shutdown = posthog.shutdown(0)
            await vi.runAllTimersAsync()
            await shutdown
        } finally {
            vi.useRealTimers()
        }
    })

    it('waits the redrive cooldown before the extra drain resends the failed batch', async () => {
        vi.useFakeTimers()
        try {
            const attempts: { at: number; events: string[] }[] = []
            const fetch: BrowserFetch = async (_input, init) => {
                const batch = (JSON.parse(String(init?.body)) as { batch: { event: string }[] }).batch
                attempts.push({ at: Date.now(), events: batch.map((event) => event.event) })
                return new Response('{}', { status: 503, headers: { 'Retry-After': '1' } })
            }
            const posthog = await createDefault({ ...recordingOptions(fetch), analytics: {} })

            posthog.capture('earlier')
            void posthog.flush()
            await vi.advanceTimersByTimeAsync(0)
            posthog.capture('instant', null, { delivery: 'immediate' })
            await vi.advanceTimersByTimeAsync(60_000)

            expect(attempts[4]?.events).toEqual(['earlier', 'instant'])
            expect(attempts[4]!.at - attempts[3]!.at).toBeGreaterThanOrEqual(3_000)
            const shutdown = posthog.shutdown(0)
            await vi.runAllTimersAsync()
            await shutdown
        } finally {
            vi.useRealTimers()
        }
    })

    it('lets an explicit flush() skip the cooldown before the extra drain', async () => {
        vi.useFakeTimers()
        try {
            const attempts: { at: number; events: string[] }[] = []
            const fetch: BrowserFetch = async (_input, init) => {
                const batch = (JSON.parse(String(init?.body)) as { batch: { event: string }[] }).batch
                attempts.push({ at: Date.now(), events: batch.map((event) => event.event) })
                return new Response('{}', { status: 503 })
            }
            const posthog = await createDefault({ ...recordingOptions(fetch), analytics: {} })

            posthog.capture('earlier')
            void posthog.flush()
            await vi.advanceTimersByTimeAsync(0)
            posthog.capture('instant', null, { delivery: 'immediate' })
            while (attempts.length < 4) await vi.advanceTimersByTimeAsync(10)
            await vi.advanceTimersByTimeAsync(10)
            void posthog.flush()
            await vi.advanceTimersByTimeAsync(0)

            expect(attempts[4]?.events).toEqual(['earlier', 'instant'])
            expect(attempts[4]!.at - attempts[3]!.at).toBeLessThanOrEqual(20)
            const shutdown = posthog.shutdown(0)
            await vi.runAllTimersAsync()
            await shutdown
        } finally {
            vi.useRealTimers()
        }
    })

    it('hands an in-flight immediate event to the keepalive request when the page hides', async () => {
        const target = stubWindowEvents()
        const requests: RecordedRequest[] = []
        const record = recordCapture(requests)
        const pending: BrowserFetch = (input, init) =>
            init?.keepalive ? record(input, init) : new Promise<Response>(() => {})
        const posthog = await createDefault(recordingOptions(pending))

        posthog.capture('instant', null, { delivery: 'immediate' })
        await settle()
        target.dispatchEvent(new Event('pagehide'))
        await settle()

        expect(names(requests)).toEqual([['instant']])
        expect(requests[0]?.keepalive).toBe(true)
        await posthog.shutdown(0)
    })

    it('keeps the event while offline and sends it when the browser reconnects', async () => {
        const target = stubWindowEvents()
        const requests: RecordedRequest[] = []
        const posthog = await createDefault({
            ...recordingOptions(recordCapture(requests)),
            navigator: { onLine: false },
        })

        posthog.capture('instant', null, { delivery: 'immediate' })
        await settle()
        expect(requests).toEqual([])

        target.dispatchEvent(new Event('online'))
        await settle()
        expect(names(requests)).toEqual([['instant']])
        await posthog.shutdown()
    })

    it('sends the event on reconnect when older offline events fill the first batch', async () => {
        vi.useFakeTimers()
        try {
            const target = stubWindowEvents()
            const requests: RecordedRequest[] = []
            const posthog = await createDefault({
                ...recordingOptions(recordCapture(requests)),
                navigator: { onLine: false },
            })

            for (let i = 0; i < 100; i++) posthog.capture('older')
            // Replenish a rate-limit token after the 100-event burst.
            await vi.advanceTimersByTimeAsync(100)
            posthog.capture('instant', null, { delivery: 'immediate' })
            target.dispatchEvent(new Event('online'))
            await vi.advanceTimersByTimeAsync(0)

            expect(requests.map((request) => request.batch.length)).toEqual([100, 1])
            expect(names(requests)[1]).toEqual(['instant'])
            await posthog.shutdown()
        } finally {
            vi.useRealTimers()
        }
    })

    it('includes the event in the shutdown flush', async () => {
        const requests: RecordedRequest[] = []
        const posthog = await createDefault(recordingOptions(recordCapture(requests)))

        posthog.capture('instant', null, { delivery: 'immediate' })
        await posthog.shutdown()

        expect(names(requests).flat()).toEqual(['instant'])
    })

    it('reports a terminal delivery failure through the client logger', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            const rejecting: BrowserFetch = async () => new Response('{}', { status: 400 })
            const posthog = await createDefault({ ...recordingOptions(rejecting), debug: true })

            posthog.capture('instant', null, { delivery: 'immediate' })
            await settle()

            expect(consoleError).toHaveBeenCalledWith('[PostHog]', 'Event delivery failed', expect.anything())
            await posthog.shutdown()
        } finally {
            consoleError.mockRestore()
        }
    })

    it('joins the keepalive handoff when captured during teardown', async () => {
        const target = stubWindowEvents()
        const requests: RecordedRequest[] = []
        const posthog = await createDefault(recordingOptions(recordCapture(requests)))
        analyticsOf(posthog)?.onBeforeTeardown(() => posthog.capture('abandoned', null, { delivery: 'immediate' }))
        posthog.capture('queued')

        target.dispatchEvent(new Event('pagehide'))
        await settle()

        expect(names(requests)).toEqual([['queued', 'abandoned']])
        expect(requests[0]?.keepalive).toBe(true)
        await posthog.shutdown()
    })
})
