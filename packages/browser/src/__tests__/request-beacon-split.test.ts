/// <reference lib="dom" />

import { request } from '../request'

vi.mock('@posthog/browser-common/utils/globals', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@posthog/browser-common/utils/globals')>()),
    fetch: vi.fn(() => Promise.resolve({ status: 200, text: () => Promise.resolve('{}') } as Response)),
    XMLHttpRequest: undefined,
    navigator: { sendBeacon: vi.fn() },
    CompressionStream: undefined,
}))

import { fetch, navigator } from '@posthog/browser-common/utils/globals'

const mockedSendBeacon = vi.mocked(navigator!.sendBeacon!)
const mockedFetch = vi.mocked(fetch!)

// One rrweb entry, large enough that a payload of several of them clears the split floor.
const rrwebEntry = (index: number) => ({ type: 3, timestamp: index, data: { text: 'a'.repeat(20000) } })

const snapshotEvent = (entries: number) => ({
    event: '$snapshot',
    properties: {
        $session_id: 'session-one',
        $window_id: 'window-one',
        $snapshot_bytes: 123456,
        $snapshot_data: Array.from({ length: entries }, (_, index) => rrwebEntry(index)),
    },
})

// jsdom's Blob has no `text()`, so read it the way the environment supports
const blobText = (blob: Blob): Promise<string> =>
    new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.readAsText(blob)
    })

const beaconBodies = async (): Promise<any[]> =>
    Promise.all(
        mockedSendBeacon.mock.calls.map(async ([, body]) =>
            JSON.parse(atob(decodeURIComponent((await blobText(body as Blob)).replace('data=', ''))))
        )
    )

describe('beacon split on unload', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    const send = (data: any) =>
        request({
            url: 'https://any.posthog-instance.com/s/',
            method: 'POST',
            transport: 'sendBeacon',
            data,
            headers: {},
        })

    it('splits a rejected single snapshot by its snapshot data so the halves still deliver', async () => {
        // reject anything the browser would refuse, accept the halves
        mockedSendBeacon.mockImplementation((_url, body) => (body as Blob).size < 60000)

        send([snapshotEvent(4)])

        const bodies = await beaconBodies()
        const delivered = bodies.filter((_, index) => mockedSendBeacon.mock.results[index].value === true)
        expect(delivered.length).toBeGreaterThan(1)

        const entries = delivered.flatMap((body) => body[0].properties.$snapshot_data)
        expect(entries).toEqual(snapshotEvent(4).properties.$snapshot_data)
        expect(mockedFetch).not.toHaveBeenCalled()
    })

    it('restates snapshot bytes for each half rather than repeating the whole payload size', async () => {
        mockedSendBeacon.mockReturnValueOnce(false).mockReturnValue(true)

        send([snapshotEvent(2)])

        const halves = (await beaconBodies()).slice(1)
        expect(halves).toHaveLength(2)
        for (const half of halves) {
            expect(half[0].properties.$snapshot_bytes).toBeLessThan(123456)
            expect(half[0].properties.$session_id).toBe('session-one')
        }
    })

    it('falls back to fetch when a single snapshot entry is all that is left', async () => {
        mockedSendBeacon.mockReturnValue(false)

        send([snapshotEvent(1)])

        expect(mockedFetch).toHaveBeenCalledTimes(1)
    })
})
