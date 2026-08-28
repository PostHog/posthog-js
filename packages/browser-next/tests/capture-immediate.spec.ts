import type { Extension } from '@posthog/browser-common'

import { createPostHog as createAutomaticPostHog } from '../src'
import { analytics } from '../src/analytics'
import { createAnalyticsDelivery, type InternalAnalyticsExtension } from '../src/analytics-internal'
import { createPostHog, type BrowserFetch, type CaptureOutcomeStatus, type CaptureSummary } from '../src/core'
import type { AnalyticsMessage } from '../src/analytics-internal'

interface CapturedRequest {
    readonly url: URL
    readonly batch: AnalyticsMessage[]
}

const responseFetch =
    (
        requests: CapturedRequest[],
        response: (message: AnalyticsMessage, attempt: number) => { status?: number; result?: unknown }
    ): BrowserFetch =>
    async (input, init = {}) => {
        const body = JSON.parse(String(init.body)) as { batch: AnalyticsMessage[] }
        const message = body.batch[0]!
        requests.push({ url: new URL(String(input)), batch: body.batch })
        const attempt = Number((init.headers as Record<string, string> | undefined)?.['PostHog-Attempt'] ?? 1)
        const outcome = response(message, attempt)
        return new Response(
            JSON.stringify(
                outcome.status && outcome.status >= 300
                    ? { error: 'capture failed' }
                    : { results: outcome.result === undefined ? {} : { [message.uuid]: outcome.result } }
            ),
            { status: outcome.status ?? 200, headers: { 'Content-Type': 'application/json' } }
        )
    }

const clientWithAnalytics = (fetch: BrowserFetch) =>
    createPostHog({
        projectToken: 'ph_test',
        capturePageview: false,
        storage: false,
        navigator: false,
        fetch,
        extensions: [analytics({ flushAt: 100, flushInterval: 0 })],
    })

const expectSummary = (
    summary: CaptureSummary,
    expected: { submitted: number; notPersisted: number; allPersisted: boolean }
): void => {
    expect(summary).toMatchObject(expected)
    expect(Object.isFrozen(summary)).toBe(true)
    expect(Object.isFrozen(summary.results)).toBe(true)
}

describe('captureImmediate', () => {
    it('bypasses the lane, awaits a V1 result, and leaves buffered work queued', async () => {
        const requests: CapturedRequest[] = []
        const posthog = await clientWithAnalytics(responseFetch(requests, () => ({ result: { result: 'ok' } })))
        const observed: string[] = []
        posthog.onEvent(({ event }) => observed.push(event))
        posthog.capture('buffered', undefined, { uuid: 'buffered-uuid' })

        const immediate = posthog.captureImmediate('immediate', { source: 'direct' }, { uuid: 'immediate-uuid' })

        expect(observed).toEqual(['buffered', 'immediate'])
        const summary = await immediate
        expectSummary(summary, { submitted: 1, notPersisted: 0, allPersisted: true })
        expect(summary.results).toEqual({ 'immediate-uuid': { result: 'ok' } })
        expect(requests.map(({ batch }) => batch.map(({ uuid }) => uuid))).toEqual([['immediate-uuid']])

        await posthog.flush()
        expect(requests.map(({ batch }) => batch.map(({ uuid }) => uuid))).toEqual([
            ['immediate-uuid'],
            ['buffered-uuid'],
        ])
        await posthog.dispose()
    })

    it('loads default analytics lazily without adding Capture V1 to the initial graph', async () => {
        const requests: CapturedRequest[] = []
        const posthog = await createAutomaticPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: false,
            fetch: responseFetch(requests, () => ({ result: { result: 'warning', details: 'accepted' } })),
        })

        const summary = await posthog.captureImmediate('lazy', undefined, { uuid: 'lazy-uuid' })

        expectSummary(summary, { submitted: 1, notPersisted: 0, allPersisted: true })
        expect(summary.results).toEqual({ 'lazy-uuid': { result: 'warning', details: 'accepted' } })
        expect(posthog.getExtension('analytics')).toBeDefined()
        expect(requests).toHaveLength(1)
        await posthog.dispose()
    })

    it.each<[string, CaptureOutcomeStatus | undefined, number, boolean]>([
        ['drop', 'drop', 1, false],
        ['warning', 'warning', 0, true],
        ['missing result', undefined, 1, false],
    ])('reports a successful V1 response with a %s outcome', async (_name, result, notPersisted, allPersisted) => {
        const requests: CapturedRequest[] = []
        const posthog = await clientWithAnalytics(
            responseFetch(requests, () => ({
                ...(result ? { result: { result, ...(result === 'drop' ? { details: 'billing_limit' } : {}) } } : {}),
            }))
        )

        const summary = await posthog.captureImmediate('outcome', undefined, { uuid: 'outcome-uuid' })

        expectSummary(summary, { submitted: 1, notPersisted, allPersisted })
        expect(summary.results).toEqual(
            result
                ? {
                      'outcome-uuid': {
                          result,
                          ...(result === 'drop' ? { details: 'billing_limit' } : {}),
                      },
                  }
                : {}
        )
        await posthog.dispose()
    })

    it('preserves a hostile caller UUID as an own result key', async () => {
        const requests: CapturedRequest[] = []
        const posthog = await clientWithAnalytics(responseFetch(requests, () => ({ result: { result: 'ok' } })))

        const summary = await posthog.captureImmediate('hostile-uuid', undefined, { uuid: '__proto__' })

        expect(Object.hasOwn(summary.results, '__proto__')).toBe(true)
        expect(summary.results['__proto__']).toEqual({ result: 'ok' })
        expect(Object.getPrototypeOf(summary.results)).toBe(Object.prototype)
        await posthog.dispose()
    })

    it('does not treat an inherited response property as a persistence result', async () => {
        const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'result')
        Object.defineProperty(Object.prototype, 'result', {
            configurable: true,
            value: 'ok',
        })
        try {
            const fetch: BrowserFetch = async () =>
                new Response('{"results":{}}', {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                })
            const posthog = await clientWithAnalytics(fetch)

            const summary = await posthog.captureImmediate('missing-hostile-uuid', undefined, { uuid: '__proto__' })

            expectSummary(summary, { submitted: 1, notPersisted: 1, allPersisted: false })
            expect(summary.results).toEqual({})
            await posthog.dispose()
        } finally {
            if (descriptor) {
                Object.defineProperty(Object.prototype, 'result', descriptor)
            } else {
                delete (Object.prototype as { result?: unknown }).result
            }
        }
    })

    it('retains a partial summary when a multi-message immediate operation fails', async () => {
        let requests = 0
        const fetch: BrowserFetch = async (_input, init = {}) => {
            requests++
            const batch = (JSON.parse(String(init.body)) as { batch: Array<{ uuid: string }> }).batch
            if (requests === 2) {
                return new Response('{"error":"terminal"}', { status: 400 })
            }
            return new Response(
                JSON.stringify({
                    results: Object.fromEntries(batch.map(({ uuid }) => [uuid, { result: 'ok' }])),
                }),
                { status: 200 }
            )
        }
        const extension = analytics() as InternalAnalyticsExtension
        const delivery = extension[createAnalyticsDelivery]({
            runtime: [
                { api: 'https://example.com', flags: 'https://example.com', assets: 'https://example.com' },
                'ph_test',
                fetch,
                undefined,
            ],
            libraryVersion: '1.2.3',
            canRetry: () => true,
            retryNow() {},
            pause() {},
            teardown() {},
            reportFailure() {},
            reportWarning() {},
        })
        const messages = Array.from(
            { length: 101 },
            (_, index): AnalyticsMessage => ({
                event: `event-${index}`,
                uuid: `uuid-${index}`,
                distinct_id: 'user',
                timestamp: '2026-01-01T00:00:00.000Z',
                properties: {},
            })
        )

        try {
            await expect(delivery.deliverImmediate(messages)).rejects.toMatchObject({
                name: 'PostHogCaptureError',
                summary: {
                    submitted: 101,
                    notPersisted: 1,
                    allPersisted: false,
                },
            })
            expect(requests).toBe(2)
        } finally {
            await extension.dispose?.()
        }
    })

    it('rejects terminal request failures with the partial summary', async () => {
        const requests: CapturedRequest[] = []
        const posthog = await clientWithAnalytics(responseFetch(requests, () => ({ status: 400 })))

        const capture = posthog.captureImmediate('terminal', undefined, { uuid: 'terminal-uuid' })

        await expect(capture).rejects.toMatchObject({
            name: 'PostHogCaptureError',
            summary: {
                submitted: 1,
                notPersisted: 1,
                allPersisted: false,
                results: {},
            },
        })
        expect(requests).toHaveLength(1)
        await posthog.dispose()
    })

    it('resolves an empty summary for local non-admission without loading analytics', async () => {
        const requests: CapturedRequest[] = []
        const posthog = await createAutomaticPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: false,
            fetch: responseFetch(requests, () => ({ result: { result: 'ok' } })),
            optOutByDefault: true,
        })

        const summary = await posthog.captureImmediate('denied')

        expectSummary(summary, { submitted: 0, notPersisted: 0, allPersisted: true })
        expect(summary.results).toEqual({})
        expect(posthog.getExtension('analytics')).toBeUndefined()
        expect(requests).toEqual([])
        await posthog.dispose()
    })

    it('rejects when core has no explicitly installed immediate delivery capability', async () => {
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: false,
            fetch: false,
        })
        const observed: string[] = []
        posthog.onEvent(({ event }) => observed.push(event))

        const capture = posthog.captureImmediate('unavailable')

        expect(observed).toEqual(['unavailable'])
        await expect(capture).rejects.toThrow('Immediate analytics delivery is unavailable')
        await posthog.dispose()
    })

    it('keeps ordinary delivery compatible with an older analytics capability', async () => {
        const delivered: AnalyticsMessage[][] = []
        const legacyAnalytics = {
            name: 'analytics',
            setup() {},
            [createAnalyticsDelivery]: () => ({
                flushAt: 1,
                flushInterval: 0,
                async deliver(events: readonly AnalyticsMessage[]) {
                    delivered.push([...events])
                },
            }),
        } as Extension
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: false,
            fetch: false,
            extensions: [legacyAnalytics],
        })

        posthog.capture('ordinary', undefined, { uuid: 'ordinary-uuid' })
        await posthog.flush()
        await expect(posthog.captureImmediate('immediate')).rejects.toThrow(
            'Immediate analytics delivery is unavailable'
        )

        expect(delivered.map((batch) => batch.map(({ uuid }) => uuid))).toEqual([['ordinary-uuid']])
        await posthog.dispose()
    })

    it('retries only the reported event and returns its final V1 outcome', async () => {
        jest.useFakeTimers()
        try {
            const requests: CapturedRequest[] = []
            const posthog = await clientWithAnalytics(
                responseFetch(requests, (_message, attempt) => ({
                    result: attempt === 1 ? { result: 'retry', details: 'try_again' } : { result: 'ok' },
                }))
            )
            const capture = posthog.captureImmediate('retry', undefined, { uuid: 'retry-uuid' })
            await jest.runAllTimersAsync()

            const summary = await capture

            expectSummary(summary, { submitted: 1, notPersisted: 0, allPersisted: true })
            expect(summary.results).toEqual({ 'retry-uuid': { result: 'ok' } })
            expect(requests).toHaveLength(2)
            await posthog.dispose()
        } finally {
            jest.useRealTimers()
        }
    })

    it('resolves with a final retry outcome after the inline attempt budget', async () => {
        jest.useFakeTimers()
        try {
            const requests: CapturedRequest[] = []
            const posthog = await clientWithAnalytics(
                responseFetch(requests, () => ({ result: { result: 'retry', details: 'try_again' } }))
            )
            const capture = posthog.captureImmediate('retry', undefined, { uuid: 'retry-uuid' })
            await jest.runAllTimersAsync()

            const summary = await capture

            expectSummary(summary, { submitted: 1, notPersisted: 1, allPersisted: false })
            expect(summary.results).toEqual({
                'retry-uuid': { result: 'retry', details: 'try_again' },
            })
            expect(requests).toHaveLength(4)
            await posthog.dispose()
        } finally {
            jest.useRealTimers()
        }
    })

    it('rejects malformed successful responses', async () => {
        const fetch: BrowserFetch = async () =>
            new Response('not-json', { status: 200, headers: { 'Content-Type': 'text/plain' } })
        const posthog = await clientWithAnalytics(fetch)

        await expect(posthog.captureImmediate('malformed')).rejects.toMatchObject({
            name: 'PostHogCaptureError',
            summary: { submitted: 1, notPersisted: 1, allPersisted: false },
        })
        await posthog.dispose()
    })

    it('does not revive a requested retry after consent is denied and granted again', async () => {
        jest.useFakeTimers()
        try {
            const requests: CapturedRequest[] = []
            const posthog = await clientWithAnalytics(
                responseFetch(requests, () => ({ result: { result: 'retry', details: 'try_again' } }))
            )
            const capture = posthog.captureImmediate('retry', undefined, { uuid: 'retry-uuid' })
            const rejection = expect(capture).rejects.toMatchObject({ name: 'PostHogCaptureError' })
            await jest.advanceTimersByTimeAsync(0)
            expect(requests).toHaveLength(1)

            posthog.optOut()
            posthog.optIn()
            await jest.runAllTimersAsync()

            await rejection
            expect(requests).toHaveLength(1)
            await posthog.dispose()
        } finally {
            jest.useRealTimers()
        }
    })

    it('aborts an in-flight immediate request during disposal', async () => {
        let started: (() => void) | undefined
        const requestStarted = new Promise<void>((resolve) => {
            started = resolve
        })
        const fetch: BrowserFetch = (_input, init = {}) =>
            new Promise<Response>((_resolve, reject) => {
                started?.()
                // eslint-disable-next-line posthog-js/no-add-event-listener
                init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
            })
        const posthog = await clientWithAnalytics(fetch)
        const capture = posthog.captureImmediate('pending', undefined, { uuid: 'pending-uuid' })
        const rejection = expect(capture).rejects.toMatchObject({ name: 'PostHogCaptureError' })
        await requestStarted

        await posthog.dispose()

        await rejection
    })
})
