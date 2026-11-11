import type { CaptureOptions, IPostHogInternal } from '../src/core'
import { createPostHog } from '../src/core'
import { analytics } from '../src/analytics'
import { EventBuffer } from '../src/event-buffer'
import { flags } from '../src/flags'
import type { FlagsExtension } from '../src/flags-internal'
import { BrowserState } from '../src/state'
import { createFetch, localRemoteConfig, requireInstalledExtension, type SentRequest } from './helpers'

const clients: Array<Awaited<ReturnType<typeof createPostHog>>> = []
const create = async () => {
    const requests: SentRequest[] = []
    let scoped!: IPostHogInternal
    const client = await createPostHog({
        projectToken: 'ph_person_property_changes',
        storage: false,
        navigator: false,
        capturePageview: false,
        remoteConfig: localRemoteConfig,
        fetch: createFetch(requests),
        extensions: [
            analytics({ flushAt: 100, flushInterval: 0 }),
            flags({ featureFlagEvaluation: false }),
            {
                name: 'observer',
                setup: (value) => {
                    scoped = value
                },
            },
        ],
    })
    clients.push(client)
    const context = requireInstalledExtension(await client.resolveExtension<FlagsExtension>('featureFlags'))
    return { client, product: requireInstalledExtension(client.analytics), context, scoped, requests }
}
const events = (requests: SentRequest[]) =>
    requests.flatMap(
        (request) => (request.body?.batch ?? []) as Array<{ event: string; properties: Record<string, unknown> }>
    )

afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.dispose()))
    vi.restoreAllMocks()
})

describe('person-property changes', () => {
    it('notifies scoped products of property changes independently of identification', async () => {
        const { client, product, scoped, context } = await create()
        const changed = vi.fn()
        const identified = vi.fn()
        scoped.onChangeProperties(changed)
        client.onIdentify(identified)
        expect(client).not.toHaveProperty('onChangeProperties')
        const id = client.distinctId
        product.setPersonProperties({ plan: 'paid' }, { source: 'docs' })
        product.unsetPersonProperties('plan')
        expect(changed.mock.calls.map(([info]) => info)).toEqual([
            { set: { plan: 'paid' }, setOnce: { source: 'docs' } },
            { unset: ['plan'] },
        ])
        expect(identified).not.toHaveBeenCalled()
        expect(context.getSurveyContext().personProperties).toEqual({ source: 'docs' })
        expect(client.distinctId).toBe(id)
    })

    it('reports identification and supplied property changes through their respective notifications', async () => {
        const { client, product, scoped, context } = await create()
        const changed = vi.fn()
        const identified = vi.fn(() => context.getSurveyContext().personProperties)
        scoped.onChangeProperties(changed)
        client.onIdentify(identified)
        await product.identify('member', { plan: 'paid' })
        await product.identify('member', { plan: 'enterprise' })
        await product.identify('member', { plan: 'enterprise' })
        expect(identified).toHaveBeenCalledTimes(2)
        expect(identified.mock.results.map(({ value }) => value)).toEqual([{ plan: 'paid' }, { plan: 'enterprise' }])
        expect(changed.mock.calls.map(([info]) => info)).toEqual([
            { set: { plan: 'paid' }, setOnce: undefined },
            { set: { plan: 'enterprise' }, setOnce: undefined },
        ])
        expect(context.getSurveyContext().personProperties).toEqual({ plan: 'enterprise' })
    })

    it('does not reenter identity listeners through a property-only setter', async () => {
        const { client, product, requests } = await create()
        const listener = vi.fn(() => product.setPersonProperties({ plan: 'paid' }))
        client.onIdentify(listener)
        product.setPersonProperties({ plan: 'paid' })
        await client.flush()
        expect(listener).not.toHaveBeenCalled()
        expect(events(requests)).toHaveLength(1)
    })

    it('snapshots property notifications and supports listener disposal and failure isolation', async () => {
        const { client, product, scoped } = await create()
        product.setPersonProperties({ initial: true })
        const changed = vi.fn()
        const removed = vi.fn()
        scoped.onChangeProperties(() => {
            throw new Error('listener failed')
        })
        scoped.onChangeProperties(changed)
        scoped.onChangeProperties(removed).dispose()
        expect(changed).not.toHaveBeenCalled()
        const set = { plan: { name: 'paid' } }
        expect(() => product.setPersonProperties(set)).not.toThrow()
        set.plan.name = 'changed'
        expect(changed).toHaveBeenCalledWith({ set: { plan: { name: 'paid' } }, setOnce: {} })
        expect(removed).not.toHaveBeenCalled()
        await client.dispose()
        product.unsetPersonProperties('plan')
        product.setPersonProperties({ later: true })
        expect(changed).toHaveBeenCalledTimes(1)
    })

    it.each(['setter', 'identify'] as const)(
        'restores local context after a denied update through %s',
        async (method) => {
            const { client, product, context, requests } = await create()
            await product.identify('member')
            await client.flush()
            requests.length = 0
            const set = (plan: string) =>
                method === 'setter' ? product.setPersonProperties({ plan }) : product.identify('member', { plan })
            await set('paid')
            await client.flush()
            client.optOut()
            await set('free')
            expect(context.getSurveyContext().personProperties).toEqual({ plan: 'free' })
            client.optIn()
            await set('paid')
            expect(context.getSurveyContext().personProperties).toEqual({ plan: 'paid' })
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
            const { client, product, context, requests } = await create()
            product.setPersonProperties({ plan: 'paid' })
            await client.flush()
            const rejection =
                seam === 'enqueue'
                    ? vi.spyOn(EventBuffer.prototype, 'enqueue').mockReturnValueOnce(false)
                    : vi.spyOn(BrowserState.prototype, 'sessionAdmitted').mockReturnValueOnce(false)
            product.setPersonProperties({ plan: 'free' })
            rejection.mockRestore()
            product.setPersonProperties({ plan: 'paid' })
            await client.flush()
            expect(context.getSurveyContext().personProperties).toEqual({ plan: 'paid' })
            expect(events(requests).map(({ properties }) => properties.$set)).toEqual([
                { plan: 'paid' },
                { plan: 'paid' },
            ])
        }
    )

    it('invalidates the prior signature when a changed local setter is rate limited', async () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
        const { client, product, context, requests } = await create()
        product.setPersonProperties({ plan: 'paid' })
        await client.flush()
        for (let index = 0; index < 99; index++) product.capture('burst')
        product.setPersonProperties({ plan: 'free' })
        expect(context.getSurveyContext().personProperties).toEqual({ plan: 'free' })
        now.mockReturnValue(2_000)
        product.setPersonProperties({ plan: 'paid' })
        await client.flush()
        expect(context.getSurveyContext().personProperties).toEqual({ plan: 'paid' })
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
                const { client, product, requests } = await create()
                await product.identify('member', { plan: 'paid' })
                await client.flush()
                requests.length = 0
                const producer = write.dynamic && product.registerDynamicEventProperties(() => write.dynamic!)
                await product[method]('person_write', write.properties, write.options)
                producer && producer.dispose()
                await product.identify('member', { plan: 'paid' })
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
            const { client, product, requests } = await create()
            await product.identify('member', { plan: 'paid' })
            await client.flush()
            requests.length = 0
            const rejection = vi.spyOn(BrowserState.prototype, 'sessionAdmitted').mockReturnValueOnce(false)
            await product[method]('rejected', null, { set: { plan: 'free' } })
            rejection.mockRestore()
            await product.identify('member', { plan: 'paid' })
            await client.flush()
            expect(events(requests)).toEqual([])
        }
    )

    it('invalidates before event observers and retains a later admitted observer update', async () => {
        const { client, product, requests } = await create()
        product.setPersonProperties({ plan: 'paid' })
        product.onEvent(({ event }) => {
            if (event === 'downgrade') product.setPersonProperties({ plan: 'paid' })
        })
        product.capture('downgrade', null, { set: { plan: 'free' } })
        product.setPersonProperties({ plan: 'paid' })
        await client.flush()
        expect(events(requests).map(({ properties }) => properties.$set)).toEqual([
            { plan: 'paid' },
            { plan: 'free' },
            { plan: 'paid' },
        ])
    })
})
