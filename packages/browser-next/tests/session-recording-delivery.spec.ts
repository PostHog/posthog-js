import { gunzipSync } from 'node:zlib'
import { createSnapshotDelivery, type SnapshotMessage } from '../src/products/session-recording/snapshot-delivery'
import type { BrowserFetch, BrowserNavigator } from '../src/core/types'

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

const decode = async (request: Request): Promise<Array<{ properties: Record<string, unknown>; sent_at: string }>> => {
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
    respond: (request: Request) => number = () => 200,
    options: { gzip?: boolean; canDeliver?: () => boolean; navigator?: BrowserNavigator } = {}
) => {
    const requests: Request[] = []
    const failures: unknown[] = []
    const fetch: BrowserFetch = async (input, init = {}) => {
        const request = { url: String(input), init }
        requests.push(request)
        return new Response('{}', { status: respond(request) })
    }
    const delivery = createSnapshotDelivery({
        runtime: [
            { api: 'https://us.i.posthog.com', flags: '', assets: '', ui: '' },
            'ph_test',
            fetch,
            options.navigator,
        ],
        endpoint: () => '/s/',
        canDeliver: options.canDeliver ?? (() => true),
        gzipEnabled: () => options.gzip ?? false,
        reportFailure: (error) => failures.push(error),
        reportWarning: () => {},
    })
    return { delivery, requests, failures }
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

    it('drops client errors without retrying', async () => {
        const { delivery, requests, failures } = setup(() => 400)

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

        it('splits batches to fit its share of the keepalive budget and sends the rest as regular requests', async () => {
            const { beacons, navigator, settled } = beaconRecorder()
            const { delivery, requests } = setup(() => 200, { navigator, gzip: true })
            const messages = [large('s1'), large('s1'), large('s1')]

            for (const snapshot of messages) delivery.enqueue(snapshot, 10)
            delivery.teardown()
            await settled()
            await vi.waitFor(() => expect(beacons.length + requests.length).toBeGreaterThan(1))
            await delivery.flush()

            const beaconBytes = beacons.reduce((total, beacon) => total + beacon.bytes.byteLength, 0)
            expect(beacons.length).toBeGreaterThan(0)
            expect(beaconBytes).toBeLessThanOrEqual(Math.floor(64 * 1024 * 0.15))
            expect(requests.length).toBeGreaterThan(0)
            expect(requests.every((request) => request.init.keepalive !== true)).toBe(true)
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
