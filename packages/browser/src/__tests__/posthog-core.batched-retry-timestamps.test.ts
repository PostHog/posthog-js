import { isUndefined } from '@posthog/core'
import { createPosthogInstance } from './helpers/posthog-instance'
import { PostHog } from '../posthog-core'
import { navigator } from '@posthog/browser-common/utils/globals'

type WireEvent = { uuid: string; event: string; timestamp?: string; offset?: number; sent_at?: string }
type CaptureBody = { batch: WireEvent[]; sent_at: string }

const network = vi.hoisted(() => ({
    status: 200,
    requests: [] as { url: string; body: string; receivedAt: number }[],
}))

vi.mock('@posthog/browser-common/utils/globals', async (importOriginal) => {
    const original = await importOriginal<typeof import('@posthog/browser-common/utils/globals')>()
    return {
        ...original,
        fetch: undefined,
        CompressionStream: undefined,
        navigator: { sendBeacon: vi.fn(() => true) },
        XMLHttpRequest: vi.fn(() => {
            let url: string
            const xhr = {
                open: vi.fn((_method: string, requestUrl: string) => {
                    url = requestUrl
                }),
                setRequestHeader: vi.fn(),
                send: vi.fn((body: string) => {
                    network.requests.push({ url, body, receivedAt: Date.now() })
                    xhr.readyState = 4
                    xhr.status = network.status
                    xhr.onreadystatechange?.()
                }),
                readyState: 0,
                status: 0,
                responseText: '{}',
                onreadystatechange: undefined as (() => void) | undefined,
            }
            return xhr
        }),
    }
})

const START = new Date('2026-01-31T23:59:50.000Z')
const RETRY_TIME = new Date('2026-02-01T08:00:00.000Z')

// Capture's offset branch overrides timestamp + (receive time - sent_at).
function normalizedTimestamp(event: WireEvent, sentAt: string, receivedAt: number): number {
    return isUndefined(event.offset)
        ? Date.parse(event.timestamp!) + receivedAt - Date.parse(sentAt)
        : receivedAt - event.offset
}

describe('batched event timestamps across retries', () => {
    let posthog: PostHog

    beforeEach(async () => {
        vi.useFakeTimers()
        vi.setSystemTime(START)
        network.status = 200
        posthog = await createPosthogInstance(undefined, {
            request_batching: true,
            disable_compression: true,
            capture_pageview: false,
            advanced_disable_flags: true,
            disable_session_recording: true,
        })
        posthog.set_config({ before_send: (event) => event })
        network.requests = []
    })

    afterEach(() => {
        posthog._requestQueue?.unload()
        posthog._retryQueue?.unload()
        vi.clearAllTimers()
        vi.useRealTimers()
    })

    it.each([0, 503])('preserves capture time across multiple delayed retries after status %s', (status) => {
        const first = posthog.capture('first click', { target: 'alpha' })!
        vi.advanceTimersByTime(1000)
        const second = posthog.capture('second click', { target: 'beta' })!
        network.status = status
        vi.advanceTimersByTime(2000)

        expect(network.requests).toHaveLength(1)
        expect(posthog._retryQueue?.length).toBe(1)

        vi.setSystemTime(RETRY_TIME)
        vi.advanceTimersByTime(3000)

        expect(network.requests).toHaveLength(2)
        expect(posthog._retryQueue?.length).toBe(1)
        expect(network.requests[1].url).toContain('retry_count=1')

        network.status = 200
        vi.setSystemTime(new Date(RETRY_TIME.getTime() + 60_000))
        vi.advanceTimersByTime(3000)

        expect(network.requests).toHaveLength(3)
        expect(posthog._retryQueue?.length).toBe(0)
        expect(network.requests[2].url).toContain('retry_count=2')
        const bodies = network.requests.map(({ body }) => JSON.parse(body) as CaptureBody)
        expect(bodies.map((body) => body.sent_at)).toEqual(
            network.requests.map(({ receivedAt }) => new Date(receivedAt).toISOString())
        )
        expect(new Set(bodies.map((body) => body.sent_at)).size).toBe(3)
        expect(first.uuid).not.toEqual(second.uuid)

        for (const [index, body] of bodies.entries()) {
            expect(body.batch).toEqual(bodies[0].batch)
            expect(body.batch.map((event) => event.timestamp)).toEqual([
                START.toISOString(),
                new Date(START.getTime() + 1000).toISOString(),
            ])
            expect(body.batch.map((event) => event.uuid)).toEqual([first.uuid, second.uuid])
            for (const [eventIndex, event] of body.batch.entries()) {
                expect(event).not.toHaveProperty('offset')
                expect(normalizedTimestamp(event, body.sent_at, network.requests[index].receivedAt)).toBe(
                    START.getTime() + eventIndex * 1000
                )
            }
        }
    })

    it('preserves a backdated timestamp when a failed batch is sent by beacon on unload', async () => {
        const timestamp = new Date('2026-01-30T12:00:00.000Z')
        const event = posthog.capture('backdated', {}, { timestamp, _batchKey: 'backdated' })!
        network.status = 0
        vi.advanceTimersByTime(3000)
        expect(posthog._retryQueue?.length).toBe(1)
        const firstBody = JSON.parse(network.requests[0].body) as CaptureBody

        vi.setSystemTime(RETRY_TIME)
        posthog._retryQueue?.unload()

        expect(navigator!.sendBeacon).toHaveBeenCalledTimes(1)
        const blob = vi.mocked(navigator!.sendBeacon!).mock.calls[0][1] as Blob
        vi.useRealTimers()
        const text = await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.readAsText(blob)
        })
        const body = JSON.parse(atob(new URLSearchParams(text).get('data')!)) as CaptureBody
        expect(body.batch).toEqual(firstBody.batch)
        expect(body.batch[0]).toMatchObject({ uuid: event.uuid, timestamp: timestamp.toISOString() })
        expect(body.batch[0]).not.toHaveProperty('offset')
        expect(body.sent_at).toBe(RETRY_TIME.toISOString())
        expect(normalizedTimestamp(body.batch[0], body.sent_at, RETRY_TIME.getTime())).toBe(timestamp.getTime())
    })

    it('preserves recording envelope and snapshot timestamps across batch retries', () => {
        const snapshot = { type: 2, timestamp: START.getTime(), data: { node: { id: 1 } } }
        posthog.capture(
            '$snapshot',
            { $snapshot_data: [snapshot] },
            {
                _url: 'http://localhost/s/',
                _batchKey: 'recording',
                _noTruncate: true,
            }
        )
        network.status = 503
        vi.advanceTimersByTime(3000)
        expect(posthog._retryQueue?.length).toBe(1)
        network.status = 200
        vi.setSystemTime(RETRY_TIME)
        vi.advanceTimersByTime(3000)

        expect(network.requests).toHaveLength(2)
        for (const request of network.requests) {
            const [event] = JSON.parse(request.body)
            expect(event.timestamp).toBe(START.toISOString())
            expect(event).not.toHaveProperty('offset')
            expect(event.properties.$snapshot_data).toEqual([snapshot])
            expect(event.sent_at).toBe(new Date(request.receivedAt).toISOString())
        }
    })
})
