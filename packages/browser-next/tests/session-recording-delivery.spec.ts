import { gunzipSync } from 'node:zlib'
import { createSnapshotDelivery, type SnapshotMessage } from '../src/products/session-recording/snapshot-delivery'
import type { BrowserFetch, BrowserNavigator } from '../src/core/types'
import { KEEPALIVE_BUDGET_BYTES } from '../src/platform/request'

interface Request {
    url: string
    init: RequestInit
}

const message = (sessionId: string, windowId = 'window'): SnapshotMessage => ({
    uuid: `${sessionId}-${Math.random()}`,
    event: '$snapshot',
    timestamp: new Date().toISOString(),
    properties: { $session_id: sessionId, $window_id: windowId, $snapshot_data: [{ type: 2 }], $snapshot_bytes: 10 },
})

const decode = async (
    request: Request
): Promise<Array<{ uuid: string; properties: Record<string, unknown>; sent_at: string }>> => {
    const body = request.init.body
    if (typeof body === 'string') {
        return JSON.parse(
            request.url.includes('compression=base64')
                ? new TextDecoder().decode(Uint8Array.from(atob(body), (char) => char.charCodeAt(0)))
                : body
        )
    }
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(await (body as Blob).arrayBuffer())
    return JSON.parse(gunzipSync(bytes).toString('utf8'))
}

const setup = (
    respond: (request: Request) => number | Response | Promise<Response> = () => 200,
    options: {
        gzip?: boolean
        canDeliver?: () => boolean
        navigator?: BrowserNavigator
        keepalive?: { remaining: number }
    } = {}
) => {
    const requests: Request[] = []
    const failures: unknown[] = []
    const fetch: BrowserFetch = async (input, init = {}) => {
        const request = { url: String(input), init }
        requests.push(request)
        const response = await respond(request)
        return response instanceof Response ? response : new Response('{}', { status: response })
    }
    const delivery = createSnapshotDelivery({
        runtime: [
            { api: 'https://us.i.posthog.com', flags: '', assets: '', ui: '' },
            'ph_test',
            fetch,
            options.navigator,
            options.keepalive ?? { remaining: KEEPALIVE_BUDGET_BYTES },
        ],
        endpoint: () => '/s/',
        canDeliver: options.canDeliver ?? (() => true),
        gzipEnabled: () => options.gzip ?? false,
        reportFailure: (error) => failures.push(error),
        reportWarning: () => {},
    })
    return { delivery, requests, failures }
}

// fake timers with the retry jitter at its midpoint, so each retry waits exactly its base delay
const withRetryClock = async (run: () => Promise<void>): Promise<void> => {
    vi.useFakeTimers()
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    try {
        await run()
    } finally {
        random.mockRestore()
        vi.useRealTimers()
    }
}

describe('snapshot delivery', () => {
    it('posts snapshots to the replay endpoint with sent_at', async () => {
        const { delivery, requests } = setup()

        delivery.enqueue(message('s1'), 10)
        await delivery.flush()

        expect(requests).toHaveLength(1)
        expect(requests[0]!.url).toBe('https://us.i.posthog.com/s/')
        const [event] = await decode(requests[0]!)
        expect(event!.properties.$session_id).toBe('s1')
        expect(event!.sent_at).toEqual(expect.any(String))
    })

    it('gzips the body when enabled', async () => {
        const { delivery, requests } = setup(() => 200, { gzip: true })

        delivery.enqueue(message('s1'), 10)
        await delivery.flush()

        const bytes = new Uint8Array(await (requests[0]!.init.body as Blob).arrayBuffer())
        expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b])
        expect(requests[0]!.url).not.toContain('compression=')
        expect((await decode(requests[0]!))[0]!.properties.$session_id).toBe('s1')
    })

    it('sends each session and window in its own request', async () => {
        const { delivery, requests } = setup()

        delivery.enqueue(message('s1'), 10)
        delivery.enqueue(message('s2'), 10)
        delivery.enqueue(message('s1', 'other-window'), 10)
        await delivery.flush()

        const groups = await Promise.all(
            requests.map(async (request) =>
                (await decode(request)).map((event) => `${event.properties.$session_id}/${event.properties.$window_id}`)
            )
        )
        expect(groups.flat()).toHaveLength(3)
        for (const group of groups) expect(new Set(group).size).toBe(1)
    })

    it('retries server errors', async () => {
        let attempts = 0
        const { delivery, requests } = setup(() => (++attempts === 1 ? 503 : 200))
        vi.useFakeTimers()
        try {
            delivery.enqueue(message('s1'), 10)
            await vi.runAllTimersAsync()
            await delivery.flush()
        } finally {
            vi.useRealTimers()
        }

        expect(requests.length).toBe(2)
    })

    it('keeps a failed batch until its retry interval when another snapshot arrives', async () => {
        await withRetryClock(async () => {
            let attempts = 0
            const { delivery, requests } = setup(() => (++attempts === 1 ? 503 : 200))
            const failed = message('s1')
            const attemptsOf = async (uuid: string): Promise<number> =>
                (await Promise.all(requests.map(decode))).filter((events) =>
                    events.some((event) => event.uuid === uuid)
                ).length

            delivery.enqueue(failed, 10)
            await vi.advanceTimersByTimeAsync(500)
            delivery.enqueue(message('s1'), 10)
            await vi.advanceTimersByTimeAsync(0)
            expect(await attemptsOf(failed.uuid)).toBe(1)

            await vi.advanceTimersByTimeAsync(500)
            expect(await attemptsOf(failed.uuid)).toBe(2)
        })
    })

    it('backs off exponentially while the server keeps failing', async () => {
        await withRetryClock(async () => {
            const sentAt: number[] = []
            const start = Date.now()
            const { delivery } = setup(() => {
                sentAt.push(Date.now() - start)
                return 503
            })

            delivery.enqueue(message('s1'), 10)
            await vi.advanceTimersByTimeAsync(60_000)

            expect(sentAt).toEqual([0, 1_000, 3_000, 7_000, 15_000, 31_000])
        })
    })

    it('keeps backing off after the failed batch is evicted from the queue', async () => {
        await withRetryClock(async () => {
            const { delivery, requests } = setup(() => 503)

            delivery.enqueue(message('s1'), 10)
            await vi.advanceTimersByTimeAsync(40_000)
            expect(requests).toHaveLength(6)

            for (let index = 0; index < 100; index++) delivery.enqueue(message('s1'), 10)
            await vi.advanceTimersByTimeAsync(0)
            expect(requests).toHaveLength(6)

            await vi.advanceTimersByTimeAsync(21_000)
            expect(requests).toHaveLength(7)
        })
    })

    it('waits at least as long as Retry-After asks', async () => {
        await withRetryClock(async () => {
            const { delivery, requests } = setup(() =>
                requests.length === 1 ? new Response('{}', { status: 503, headers: { 'Retry-After': '20' } }) : 200
            )

            delivery.enqueue(message('s1'), 10)
            await vi.advanceTimersByTimeAsync(19_999)
            expect(requests).toHaveLength(1)

            await vi.advanceTimersByTimeAsync(1)
            expect(requests).toHaveLength(2)
        })
    })

    it('holds snapshots while offline and sends them once back online', async () => {
        await withRetryClock(async () => {
            const navigator = { onLine: false }
            const { delivery, requests } = setup(() => 200, { navigator })

            delivery.enqueue(message('s1'), 10)
            await vi.advanceTimersByTimeAsync(10_000)
            expect(requests).toHaveLength(0)

            navigator.onLine = true
            await vi.advanceTimersByTimeAsync(1_000)
            expect(requests).toHaveLength(1)
        })
    })

    it('keeps retrying network errors on the same backoff', async () => {
        await withRetryClock(async () => {
            const { delivery, requests } = setup(() => {
                throw new TypeError('Failed to fetch')
            })

            delivery.enqueue(message('s1'), 10)
            await vi.advanceTimersByTimeAsync(60_000)

            expect(requests).toHaveLength(6)
        })
    })

    it('aborts a stalled request after 60 seconds and retries it, as posthog-js does', async () => {
        await withRetryClock(async () => {
            const { delivery, requests } = setup(({ init }) =>
                requests.length === 1
                    ? new Promise<Response>((_resolve, reject) => {
                          init.signal!.onabort = () => reject(new DOMException('', 'AbortError'))
                      })
                    : 200
            )

            delivery.enqueue(message('s1'), 10)
            await vi.advanceTimersByTimeAsync(60_000)
            const flushed = delivery.flush()
            await vi.advanceTimersByTimeAsync(1_000)

            expect(requests).toHaveLength(2)
            expect((await decode(requests[1]!))[0]!.uuid).toBe((await decode(requests[0]!))[0]!.uuid)
            await expect(flushed).resolves.toBeUndefined()
        })
    })

    it('returns to the base retry interval after a successful send', async () => {
        await withRetryClock(async () => {
            const statuses = [503, 503, 200, 503]
            const { delivery, requests } = setup(() => statuses[requests.length - 1] ?? 200)

            delivery.enqueue(message('s1'), 10)
            await vi.advanceTimersByTimeAsync(2_999)
            expect(requests).toHaveLength(2)
            await vi.advanceTimersByTimeAsync(1)
            expect(requests).toHaveLength(3)

            delivery.enqueue(message('s1'), 10)
            await vi.advanceTimersByTimeAsync(0)
            expect(requests).toHaveLength(4)
            await vi.advanceTimersByTimeAsync(1_000)
            expect(requests).toHaveLength(5)
        })
    })

    it('retries rate-limited batches', async () => {
        await withRetryClock(async () => {
            const { delivery, requests } = setup(() => (requests.length === 1 ? 429 : 200))

            delivery.enqueue(message('s1'), 10)
            await vi.advanceTimersByTimeAsync(1_000)

            expect(requests).toHaveLength(2)
        })
    })

    it.each([400, 501])('drops a batch without retrying on HTTP %i', async (status) => {
        const { delivery, requests, failures } = setup(() => status)

        delivery.enqueue(message('s1'), 10)
        await delivery.flush()
        await delivery.flush()

        expect(requests).toHaveLength(1)
        expect(failures).toHaveLength(1)
    })

    it('does not send while delivery is not permitted', async () => {
        const { delivery, requests } = setup(() => 200, { canDeliver: () => false })

        delivery.enqueue(message('s1'), 10)
        await delivery.flush()

        expect(requests).toHaveLength(0)
    })

    describe('on unload', () => {
        const beaconRecorder = (accept: (bytes: number) => boolean = () => true) => {
            const beacons: Array<{ url: string; bytes: Uint8Array }> = []
            const pending: Promise<void>[] = []
            const navigator: BrowserNavigator = {
                sendBeacon: (url, data) => {
                    const accepted = accept((data as Blob).size)
                    if (accepted) {
                        pending.push(
                            (data as Blob).arrayBuffer().then((buffer) => {
                                beacons.push({ url: String(url), bytes: new Uint8Array(buffer) })
                            })
                        )
                    }
                    return accepted
                },
            }
            return { beacons, navigator, settled: () => Promise.all(pending) }
        }
        // random text that gzip cannot shrink much, so batches outgrow the unload budget
        const large = (sessionId: string): SnapshotMessage => {
            const base = message(sessionId)
            return {
                ...base,
                properties: {
                    ...base.properties,
                    $snapshot_data: [
                        { type: 3, data: Array.from(crypto.getRandomValues(new Uint8Array(4500))).join(',') },
                    ],
                },
            }
        }
        const ids = (bytes: Uint8Array): string[] =>
            (JSON.parse(gunzipSync(bytes).toString('utf8')) as SnapshotMessage[]).map((event) => event.uuid)

        it('sends gzip beacons without a compression parameter when the project supports gzip', async () => {
            const { beacons, navigator, settled } = beaconRecorder()
            const { delivery, requests } = setup(() => 200, { navigator, gzip: true })

            delivery.enqueue(message('s1'), 10)
            delivery.teardown()
            await settled()
            await delivery.flush()

            expect(beacons).toHaveLength(1)
            expect(beacons[0]!.url).toBe('https://us.i.posthog.com/s/')
            expect([beacons[0]!.bytes[0], beacons[0]!.bytes[1]]).toEqual([0x1f, 0x8b])
            expect(requests).toHaveLength(0)
        })

        it('splits batches to fit the remaining keepalive budget and sends the rest as regular requests', async () => {
            const { beacons, navigator, settled } = beaconRecorder()
            const keepalive = { remaining: 10_000 }
            const { delivery, requests } = setup(() => 200, { navigator, gzip: true, keepalive })
            const messages = [large('s1'), large('s1'), large('s1')]

            for (const snapshot of messages) delivery.enqueue(snapshot, 10)
            delivery.teardown()
            await settled()
            await vi.waitFor(() => expect(beacons.length + requests.length).toBeGreaterThan(1))
            await delivery.flush()

            const beaconBytes = beacons.reduce((total, beacon) => total + beacon.bytes.byteLength, 0)
            expect(beacons.length).toBeGreaterThan(0)
            expect(beaconBytes).toBeLessThanOrEqual(10_000)
            // the browser accounts for beacons, so they do not hold the shared budget, as in posthog-js
            expect(keepalive.remaining).toBe(10_000)
            expect(requests.length).toBeGreaterThan(0)
            expect(requests.every((request) => request.init.keepalive !== true)).toBe(true)
            const sent = [
                ...beacons.flatMap((beacon) => ids(beacon.bytes)),
                ...requests.flatMap((request) => ids(request.init.body as Uint8Array)),
            ]
            expect(sent.sort()).toEqual(messages.map((snapshot) => snapshot.uuid).sort())
        })

        it('sends no beacons once the shared keepalive budget is spent, as posthog-js shares one pool', async () => {
            const { beacons, navigator, settled } = beaconRecorder()
            const { delivery, requests } = setup(() => 200, { navigator, gzip: true, keepalive: { remaining: 0 } })

            delivery.enqueue(message('s1'), 10)
            delivery.teardown()
            await settled()
            await vi.waitFor(() => expect(requests).toHaveLength(1))

            expect(beacons).toHaveLength(0)
            expect(requests[0]!.init.keepalive).not.toBe(true)
        })

        it('sends an over-budget backlog in a few requests rather than one per snapshot', async () => {
            const { beacons, navigator, settled } = beaconRecorder()
            const { delivery, requests } = setup(() => 200, { navigator, gzip: true, keepalive: { remaining: 10_000 } })
            const messages = Array.from({ length: 16 }, () => large('s1'))

            for (const snapshot of messages) delivery.enqueue(snapshot, 10)
            delivery.teardown()
            await settled()
            await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0))
            await delivery.flush()

            expect(beacons.length + requests.length).toBeLessThanOrEqual(5)
            const sent = [
                ...beacons.flatMap((beacon) => ids(beacon.bytes)),
                ...requests.flatMap((request) => ids(request.init.body as Uint8Array)),
            ]
            expect(sent.sort()).toEqual(messages.map((snapshot) => snapshot.uuid).sort())
        })

        it('falls back to a regular request when the browser rejects the beacon', async () => {
            const { navigator } = beaconRecorder(() => false)
            const { delivery, requests } = setup(() => 200, { navigator, gzip: true })

            delivery.enqueue(message('s1'), 10)
            delivery.teardown()
            await vi.waitFor(() => expect(requests).toHaveLength(1))
            await delivery.flush()

            expect(requests).toHaveLength(1)
            expect(requests[0]!.init.keepalive).toBeUndefined()
        })

        it('holds keepalive bytes in the shared budget only while the request is in flight', async () => {
            const keepalive = { remaining: KEEPALIVE_BUDGET_BYTES }
            const { delivery, requests } = setup(() => 200, { keepalive })

            delivery.enqueue(message('s1'), 10)
            delivery.teardown()

            expect(requests[0]!.init.keepalive).toBe(true)
            expect(keepalive.remaining).toBe(KEEPALIVE_BUDGET_BYTES - (requests[0]!.init.body as string).length)
            await vi.waitFor(() => expect(keepalive.remaining).toBe(KEEPALIVE_BUDGET_BYTES))
        })

        it('uses a keepalive request without sendBeacon', async () => {
            const { delivery, requests } = setup(() => 200)

            delivery.enqueue(message('s1'), 10)
            delivery.teardown()
            await vi.waitFor(() => expect(requests).toHaveLength(1))

            expect(requests[0]!.init.keepalive).toBe(true)
            expect(requests[0]!.url).toBe('https://us.i.posthog.com/s/?compression=base64')
        })

        it('keeps snapshots whose unload request failed, so a page that survives retries them', async () => {
            let attempts = 0
            const { delivery, requests } = setup(() => (++attempts === 1 ? 503 : 200))

            delivery.enqueue(message('s1'), 10)
            delivery.teardown()
            await vi.waitFor(() => expect(requests).toHaveLength(1))
            await new Promise((resolve) => setTimeout(resolve, 0))
            await delivery.flush()

            expect(requests).toHaveLength(2)
        })

        it('does not resend snapshots that are already in flight', async () => {
            const { beacons, navigator } = beaconRecorder()
            let release: (() => void) | undefined
            const requests: Request[] = []
            const fetch: BrowserFetch = (input, init = {}) => {
                requests.push({ url: String(input), init })
                return new Promise((resolve) => {
                    release = () => resolve(new Response('{}', { status: 200 }))
                })
            }
            const delivery = createSnapshotDelivery({
                runtime: [
                    { api: 'https://us.i.posthog.com', flags: '', assets: '', ui: '' },
                    'ph_test',
                    fetch,
                    navigator,
                    { remaining: KEEPALIVE_BUDGET_BYTES },
                ],
                endpoint: () => '/s/',
                canDeliver: () => true,
                gzipEnabled: () => false,
                reportFailure: () => {},
                reportWarning: () => {},
            })

            delivery.enqueue(message('s1'), 10)
            await vi.waitFor(() => expect(requests).toHaveLength(1))
            delivery.teardown()
            release?.()

            expect(beacons).toHaveLength(0)
        })
    })

    it('drops queued snapshots on purge', async () => {
        const { delivery, requests } = setup()

        delivery.enqueue(message('s1'), 10)
        delivery.purge()
        await delivery.flush()

        expect(requests).toHaveLength(0)
    })
})
