import { STORED_PERSON_PROPERTIES_KEY } from '@posthog/browser-common/constants'
import type { CaptureOptions, IPostHog } from '../src/composition/npm/core'
import { createPostHog } from '../src/composition/npm/core'
import { EventBuffer } from '../src/products/analytics/admission/event-buffer'
import { setPersonProperties, unsetPersonProperties } from '../src/products/analytics/person'
import { flags } from '../src/products/flags/flags'
import { BrowserState } from '../src/core/state/state'
import { createFetch, localRemoteConfig, type SentRequest } from './helpers'

const clients: IPostHog[] = []
const create = async () => {
    const requests: SentRequest[] = []
    const client = await createPostHog({
        projectToken: 'ph_person_property_changes',
        storage: false,
        navigator: false,
        capturePageview: false,
        remoteConfig: localRemoteConfig,
        fetch: createFetch(requests),
        analytics: { flushAt: 100, flushInterval: 0 },
        extensions: [flags({ featureFlagEvaluation: false })],
    })
    clients.push(client)
    return { client, requests }
}
/** Person properties retained locally for flag and survey targeting. */
const storedPersonProperties = (client: IPostHog) => client.kv.get(STORED_PERSON_PROPERTIES_KEY)
const events = (requests: SentRequest[]) =>
    requests.flatMap(
        (request) => (request.body?.batch ?? []) as Array<{ event: string; properties: Record<string, unknown> }>
    )

afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.dispose()))
    vi.restoreAllMocks()
})

describe('person-property changes', () => {
    it('notifies listeners of property changes independently of identification', async () => {
        const { client } = await create()
        const changed = vi.fn()
        const identified = vi.fn()
        client.onChangeProperties(changed)
        client.onIdentify(identified)
        const id = client.distinctId
        setPersonProperties(client, { plan: 'paid' }, { source: 'docs' })
        unsetPersonProperties(client, 'plan')
        expect(changed.mock.calls.map(([info]) => info)).toEqual([
            { set: { plan: 'paid' }, setOnce: { source: 'docs' } },
            { unset: ['plan'] },
        ])
        expect(identified).not.toHaveBeenCalled()
        expect(storedPersonProperties(client)).toEqual({ source: 'docs' })
        expect(client.distinctId).toBe(id)
    })

    it('reports identification and supplied property changes through their respective notifications', async () => {
        const { client } = await create()
        const changed = vi.fn()
        const identified = vi.fn(() => storedPersonProperties(client))
        client.onChangeProperties(changed)
        client.onIdentify(identified)
        client.identify('member', { plan: 'paid' })
        client.identify('member', { plan: 'enterprise' })
        client.identify('member', { plan: 'enterprise' })
        expect(identified).toHaveBeenCalledTimes(2)
        expect(identified.mock.results.map(({ value }) => value)).toEqual([{ plan: 'paid' }, { plan: 'enterprise' }])
        expect(changed.mock.calls.map(([info]) => info)).toEqual([
            { set: { plan: 'paid' }, setOnce: undefined },
            { set: { plan: 'enterprise' }, setOnce: undefined },
        ])
        expect(storedPersonProperties(client)).toEqual({ plan: 'enterprise' })
    })

    it('does not reenter identity listeners through a property-only setter', async () => {
        const { client, requests } = await create()
        const listener = vi.fn(() => setPersonProperties(client, { plan: 'paid' }))
        client.onIdentify(listener)
        setPersonProperties(client, { plan: 'paid' })
        await client.flush()
        expect(listener).not.toHaveBeenCalled()
        expect(events(requests)).toHaveLength(1)
    })

    it('snapshots property notifications and supports listener disposal and failure isolation', async () => {
        const { client } = await create()
        setPersonProperties(client, { initial: true })
        const changed = vi.fn()
        const removed = vi.fn()
        client.onChangeProperties(() => {
            throw new Error('listener failed')
        })
        client.onChangeProperties(changed)
        client.onChangeProperties(removed).dispose()
        expect(changed).not.toHaveBeenCalled()
        const set = { plan: { name: 'paid' } }
        expect(() => setPersonProperties(client, set)).not.toThrow()
        set.plan.name = 'changed'
        expect(changed).toHaveBeenCalledWith({ set: { plan: { name: 'paid' } }, setOnce: {} })
        expect(removed).not.toHaveBeenCalled()
        await client.dispose()
        unsetPersonProperties(client, 'plan')
        setPersonProperties(client, { later: true })
        expect(changed).toHaveBeenCalledTimes(1)
    })

    it.each(['setter', 'identify'] as const)(
        'restores local context after a denied update through %s',
        async (method) => {
            const { client, requests } = await create()
            client.identify('member')
            await client.flush()
            requests.length = 0
            const set = (plan: string) =>
                method === 'setter' ? setPersonProperties(client, { plan }) : client.identify('member', { plan })
            await set('paid')
            await client.flush()
            client.optOut()
            await set('free')
            expect(storedPersonProperties(client)).toEqual({ plan: 'free' })
            client.optIn()
            await set('paid')
            expect(storedPersonProperties(client)).toEqual({ plan: 'paid' })
            await client.flush()
            expect(events(requests).map(({ properties }) => properties.$set)).toEqual([
                { plan: 'paid' },
                { plan: 'paid' },
            ])
        }
    )

    it.each(['enqueue', 'sessionAdmitted'] as const)(
        'invalidates an earlier signature after a local update rejected by %s',
        async (seam) => {
            const { client, requests } = await create()
            setPersonProperties(client, { plan: 'paid' })
            await client.flush()
            const rejection =
                seam === 'enqueue'
                    ? vi.spyOn(EventBuffer.prototype, 'enqueue').mockReturnValueOnce(false)
                    : vi.spyOn(BrowserState.prototype, 'sessionAdmitted').mockReturnValueOnce(false)
            setPersonProperties(client, { plan: 'free' })
            rejection.mockRestore()
            setPersonProperties(client, { plan: 'paid' })
            await client.flush()
            expect(storedPersonProperties(client)).toEqual({ plan: 'paid' })
            expect(events(requests).map(({ properties }) => properties.$set)).toEqual([
                { plan: 'paid' },
                { plan: 'paid' },
            ])
        }
    )

    it('invalidates the prior signature when a changed local setter is rate limited', async () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
        const { client, requests } = await create()
        setPersonProperties(client, { plan: 'paid' })
        await client.flush()
        for (let index = 0; index < 99; index++) client.capture('burst')
        setPersonProperties(client, { plan: 'free' })
        expect(storedPersonProperties(client)).toEqual({ plan: 'free' })
        now.mockReturnValue(2_000)
        setPersonProperties(client, { plan: 'paid' })
        await client.flush()
        expect(storedPersonProperties(client)).toEqual({ plan: 'paid' })
        expect(
            events(requests)
                .filter(({ event }) => event === '$set')
                .map(({ properties }) => properties.$set)
        ).toEqual([{ plan: 'paid' }, { plan: 'paid' }])
    })

    it.each(['capture', 'captureImmediate'] as const)(
        'invalidates the signature for finalized person writes admitted through %s',
        async (method) => {
            const writes: Array<{
                properties?: Record<string, unknown>
                options?: CaptureOptions
                dynamic?: Record<string, unknown>
            }> = [
                { options: { set: { plan: 'free' } } },
                { options: { setOnce: { source: 'docs' } } },
                { properties: { $set: { plan: 'free' } } },
                { properties: { $set_once: { source: 'docs' } } },
                { properties: { $unset: ['plan'] } },
                { dynamic: { $set: { plan: 'free' } } },
                { dynamic: { $set_once: { source: 'docs' } } },
                { dynamic: { $unset: ['plan'] } },
            ]
            for (const write of writes) {
                const { client, requests } = await create()
                client.identify('member', { plan: 'paid' })
                await client.flush()
                requests.length = 0
                const producer = write.dynamic && client.registerDynamicEventProperties(() => write.dynamic!)
                await client[method]('person_write', write.properties, write.options)
                producer && producer.dispose()
                client.identify('member', { plan: 'paid' })
                await client.flush()
                expect(events(requests).map(({ event }) => event)).toEqual(['person_write', '$set'])
                expect(events(requests).at(-1)?.properties.$set).toEqual({ plan: 'paid' })
                await client.dispose()
            }
        }
    )

    it.each(['capture', 'captureImmediate'] as const)(
        'retains the signature when an ordinary %s is rejected',
        async (method) => {
            const { client, requests } = await create()
            client.identify('member', { plan: 'paid' })
            await client.flush()
            requests.length = 0
            const rejection = vi.spyOn(BrowserState.prototype, 'sessionAdmitted').mockReturnValueOnce(false)
            await client[method]('rejected', null, { set: { plan: 'free' } })
            rejection.mockRestore()
            client.identify('member', { plan: 'paid' })
            await client.flush()
            expect(events(requests)).toEqual([])
        }
    )

    it('invalidates before event observers and retains a later admitted observer update', async () => {
        const { client, requests } = await create()
        setPersonProperties(client, { plan: 'paid' })
        client.onEvent(({ event }) => {
            if (event === 'downgrade') setPersonProperties(client, { plan: 'paid' })
        })
        client.capture('downgrade', null, { set: { plan: 'free' } })
        setPersonProperties(client, { plan: 'paid' })
        await client.flush()
        expect(events(requests).map(({ properties }) => properties.$set)).toEqual([
            { plan: 'paid' },
            { plan: 'free' },
            { plan: 'paid' },
        ])
    })
})
