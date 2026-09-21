import { gunzipSync, strFromU8 } from 'fflate'
import type { Client } from '@posthog/browser-common'
import { createPostHog } from '../src/core'
import type { BrowserFetch, BrowserNavigator, PostHog, RemoteConfig } from '../src/core'
import { createReplayDelivery } from '../src/replay-delivery'
import { localRemoteConfig } from './helpers'

const clients: PostHog[] = []
const deliveries: ReturnType<typeof createReplayDelivery>[] = []
const create = async (
    fetch: BrowserFetch,
    compression: RemoteConfig['supportedCompression'] = [],
    navigator?: BrowserNavigator,
    api = 'https://api.test'
) => {
    let view!: Client
    const client = await createPostHog({
        projectToken: 'ph_delivery',
        storage: false,
        fetch: false,
        navigator: false,
        capturePageview: false,
        remoteConfig: { ...localRemoteConfig, supportedCompression: compression },
        extensions: [
            {
                name: 'delivery-test',
                setup(value) {
                    view = value
                },
            },
        ],
    })
    const delivery = createReplayDelivery(view, {
        runtime: [{ api, flags: 'https://flags.test' }, 'ph_delivery', fetch, navigator],
        canDeliver: () => !client.hasOptedOut(),
        pendingStorage: undefined,
        persistenceKey: 'test',
        refreshRemoteConfig() {},
    })
    clients.push(client)
    deliveries.push(delivery)
    return { client, delivery }
}
afterEach(async () => {
    await Promise.all(deliveries.splice(0).map((delivery) => delivery.dispose()))
    await Promise.all(clients.splice(0).map((client) => client.dispose()))
})

describe('replay delivery protocol', () => {
    it.each(['gzip-js', 'base64', 'json'] as const)(
        'encodes the supported snapshot wire using %s',
        async (compression) => {
            let sentBody!: Blob
            let sentUrl!: URL
            const { client, delivery } = await create(
                async (url, init) => {
                    sentUrl = new URL(String(url))
                    sentBody = init!.body as Blob
                    expect(init!.credentials).toBe('omit')
                    return new Response('{}')
                },
                compression === 'json' ? [] : [compression]
            )
            const id = client.distinctId
            delivery.capture('/s/', {
                token: 'spoofed',
                distinct_id: 'spoofed',
                $snapshot_data: [{ data: '🚀'.repeat(5000) }],
            })
            await client.identify('new-person')
            await delivery.flush()
            const text =
                compression === 'gzip-js'
                    ? strFromU8(gunzipSync(new Uint8Array(await sentBody.arrayBuffer())))
                    : compression === 'base64'
                      ? Buffer.from(new URLSearchParams(await sentBody.text()).get('data')!, 'base64').toString('utf8')
                      : await sentBody.text()
            const batch = JSON.parse(text)
            expect(sentUrl.pathname).toBe('/s/')
            expect(sentUrl.searchParams.has('sent_at')).toBe(true)
            expect(batch).toHaveLength(1)
            expect(batch[0]).toMatchObject({
                event: '$snapshot',
                properties: { token: 'ph_delivery', distinct_id: id, $snapshot_data: [{ data: '🚀'.repeat(5000) }] },
            })
            expect(batch[0].uuid).toBeTruthy()
            expect(Number.isFinite(Date.parse(batch[0].timestamp))).toBe(true)
        }
    )

    it('preserves a configured proxy path for replay endpoints', async () => {
        const fetch = vi.fn(async () => new Response('{}'))
        const { delivery } = await create(fetch, [], undefined, 'https://api.test/ingest')
        delivery.capture('/custom-replay/', { $snapshot_data: [] })
        await delivery.flush()
        expect(String((fetch.mock.calls[0] as unknown as [URL])[0])).toMatch(
            /^https:\/\/api.test\/ingest\/custom-replay\//
        )
    })

    it.each([0, 408, 429, 500, 400])('retains only transient request failures (%s)', async (status) => {
        const fetch = vi
            .fn<Parameters<BrowserFetch>, ReturnType<BrowserFetch>>()
            .mockImplementationOnce(async () => {
                if (status === 0) throw new Error('offline')
                return new Response('{}', { status })
            })
            .mockResolvedValue(new Response('{}'))
        const { delivery } = await create(fetch)
        delivery.capture('/s/', { $snapshot_data: [] })
        await delivery.flush()
        await delivery.flush()
        expect(fetch).toHaveBeenCalledTimes(status === 400 ? 1 : 2)
    })

    it('enforces bounded retained bytes without entering transport', async () => {
        const fetch = vi.fn(async () => new Response('{}'))
        const { delivery } = await create(fetch)
        delivery.capture('/s/', { $snapshot_data: 'x'.repeat(9 * 1024 * 1024) })
        await delivery.flush()
        expect(fetch).not.toHaveBeenCalled()
    })

    it('uses one aggregate keepalive budget and preserves retained queue accounting', async () => {
        const beacon = vi.fn(() => true)
        const fetch = vi.fn(async () => new Response('{}'))
        const { delivery } = await create(fetch, [], { sendBeacon: beacon })
        for (let index = 0; index < 3; index++) delivery.capture('/s/', { $snapshot_data: 'x'.repeat(30000) })
        delivery.teardown()
        expect(beacon).toHaveBeenCalledOnce()
        expect((beacon.mock.calls[0] as unknown as [string, Blob])[1].size).toBeLessThan(64 * 1024 * 0.8)
        await delivery.flush()
        expect(fetch).toHaveBeenCalledTimes(3)
    })

    it('does not send after consent changes during serialization', async () => {
        const fetch = vi.fn(async () => new Response('{}'))
        const { client, delivery } = await create(fetch)
        delivery.capture('/s/', {
            get $snapshot_data() {
                client.optOut()
                return []
            },
        })
        await delivery.flush()
        expect(fetch).not.toHaveBeenCalled()
    })
})
