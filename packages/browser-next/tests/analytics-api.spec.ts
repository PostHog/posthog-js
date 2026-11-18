import type { CaptureOptions } from '@posthog/browser-common'
import { createPostHog, type IPostHog } from '../src/composition/npm/core'
import { BrowserState } from '../src/core/state/state'
import { EventBuffer } from '../src/products/analytics/admission/event-buffer'
import { group } from '../src/products/analytics/groups'
import { createFetch, localRemoteConfig, type SentRequest } from './helpers'

const options = {
    projectToken: 'ph_analytics_api',
    capturePageview: false,
    storage: false,
    navigator: false,
    remoteConfig: localRemoteConfig,
} as const

const clients: IPostHog[] = []
const create = async () => {
    const requests: SentRequest[] = []
    const client = await createPostHog({
        ...options,
        fetch: createFetch(requests),
        analytics: { flushAt: 100, flushInterval: 0 },
    })
    clients.push(client)
    return { client, requests }
}
const events = (requests: SentRequest[]): Array<{ event: string; properties: Record<string, unknown> }> =>
    requests.flatMap(
        (request) => (request.body?.batch ?? []) as Array<{ event: string; properties: Record<string, unknown> }>
    )

afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.dispose()))
    vi.restoreAllMocks()
})

describe('client analytics API', () => {
    it('exposes common analytics operations on the client and keeps less common ones in function imports', async () => {
        const { client } = await create()
        for (const name of [
            'capture',
            'captureImmediate',
            'identify',
            'reset',
            'register',
            'registerOnce',
            'unregister',
            'getProperty',
            'registerForSession',
            'unregisterForSession',
            'registerDynamicEventProperties',
            'onEvent',
            'getExtension',
        ] as const) {
            expect(typeof client[name], name).toBe('function')
        }
        expect(typeof client.isRateLimited).toBe('boolean')
        for (const name of [
            'analytics',
            'alias',
            'group',
            'groupIdentify',
            'resetGroups',
            'createPersonProfile',
            'setPersonProperties',
            'unsetPersonProperties',
            'setInternalOrTestUser',
        ]) {
            expect(name in client, name).toBe(false)
        }
    })

    it('admits capture synchronously and sends its snapshotted properties', async () => {
        const { client, requests } = await create()
        const observed: unknown[] = []
        const subscription = client.onEvent((event) => observed.push(event))
        const properties = { cart: { count: 1 } }
        expect(client.capture('checkout', properties)).toBe(true)
        properties.cart.count = 2
        expect(observed).toMatchObject([{ event: 'checkout', properties: { cart: { count: 1 } } }])
        expect(client.session?.sessionId).toBeDefined()
        await client.flush()
        expect(requests[0]?.body?.batch).toMatchObject([{ event: 'checkout', properties: { cart: { count: 1 } } }])
        subscription.dispose()
        client.capture('after_disposal')
        expect(observed).toHaveLength(1)
    })

    it('updates identity and groups and preserves reset notifications', async () => {
        const { client } = await create()
        const changes: string[] = []
        const originalDevice = client.deviceId
        client.onIdentify(() => changes.push('identify'))
        client.onGroup(() => changes.push('group'))
        client.onReset(() => changes.push('reset'))
        client.identify('user-123')
        group(client, 'company', 'company-123')
        expect(client.distinctId).toBe('user-123')
        expect(client.groups).toEqual({ company: 'company-123' })
        client.reset()
        expect(client.distinctId).not.toBe('user-123')
        expect(client.deviceId).toBe(originalDevice)
        expect(client.groups).toEqual({})
        expect(changes).toEqual(['identify', 'group', 'reset'])
    })

    it('applies dynamic event properties to every admitted event until disposed', async () => {
        const { client } = await create()
        const observed: Array<{ event: string; properties: Readonly<Record<string, unknown>> }> = []
        client.onEvent((event) => observed.push(event))
        const registration = client.registerDynamicEventProperties(() => ({ source: 'dynamic' }))
        client.capture('captured')
        client.identify('person')
        group(client, 'company', 'company-123')
        await client.captureImmediate('immediate')
        registration.dispose()
        client.capture('after_disposal')
        expect(observed.map(({ event, properties }) => [event, properties.source])).toEqual([
            ['captured', 'dynamic'],
            ['$identify', 'dynamic'],
            ['$groupidentify', 'dynamic'],
            ['immediate', 'dynamic'],
            ['after_disposal', undefined],
        ])
    })

    it.each(['enqueue', 'sessionAdmitted'] as const)(
        'does not publish or commit an event rejected by %s',
        async (seam) => {
            const { client } = await create()
            const captured = vi.fn()
            client.onEvent(captured)
            const reject =
                seam === 'enqueue'
                    ? vi.spyOn(EventBuffer.prototype, 'enqueue').mockReturnValue(false)
                    : vi.spyOn(BrowserState.prototype, 'sessionAdmitted').mockReturnValue(false)
            try {
                expect(client.capture('rejected')).toBe(true)
                expect(captured).not.toHaveBeenCalled()
                expect(client.session).toBeUndefined()
            } finally {
                reject.mockRestore()
            }
        }
    )
})

describe('client capture admission', () => {
    it.each([{}, { delivery: 'unload' }] as const)(
        'returns the capture rate-limit status independently of admission: %j',
        async (captureOptions) => {
            const { client } = await create()
            expect(client.capture('accepted', null, captureOptions)).toBe(true)
            client.optOut()
            expect(client.capture('denied', null, captureOptions)).toBe(true)
            await client.dispose()
            expect(client.capture('disposed', null, captureOptions)).toBe(true)
        }
    )

    it('rate limits unload capture through the same admission policy', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(42)
        const { client } = await create()
        for (let index = 0; index < 100; index++) expect(client.capture('burst')).toBe(true)
        expect(client.capture('limited', null, { delivery: 'unload' })).toBe(false)
    })

    it('contains delivery-option getters', async () => {
        const captureOptions: CaptureOptions = {
            get delivery(): 'unload' {
                throw new Error('delivery getter failed')
            },
        }
        const { client } = await create()
        expect(client.capture('installed', null, captureOptions)).toBe(true)
    })

    it('keeps identity operations inert after disposal', async () => {
        const { client, requests } = await create()
        const distinctId = client.distinctId
        await client.dispose()
        expect(() => client.identify('disposed')).not.toThrow()
        expect(() => group(client, 'organization', 'disposed', { invalid: true })).not.toThrow()
        expect(client.distinctId).toBe(distinctId)
        expect(client.groups).toEqual({})
        expect(events(requests)).toHaveLength(0)
    })
})
