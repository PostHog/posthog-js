import { analytics, type AnalyticsOptions } from '../src/products/analytics/analytics'
import { flags } from '../src/products/flags/flags'
import type { FlagsExtension } from '../src/products/flags/flags-internal'
import { createPostHog } from '../src/composition/npm/core'
import { createPostHog as createRootPostHog } from '../src/composition/npm'
import { BrowserState } from '../src/core/state/state'
import { EventBuffer } from '../src/products/analytics/admission/event-buffer'
import { createFetch, localRemoteConfig, MemoryStorage, requireInstalledExtension, type SentRequest } from './helpers'

const options = {
    projectToken: 'ph_person_profiles',
    storage: false,
    navigator: false,
    capturePageview: false,
    remoteConfig: localRemoteConfig,
} as const

interface Event {
    event: string
    distinct_id: string
    options: { process_person_profile: boolean }
    properties: Record<string, unknown>
}
const events = (requests: SentRequest[]): Event[] =>
    requests.flatMap((request) => (request.body?.batch ?? []) as Event[])
const clients: Array<Awaited<ReturnType<typeof createPostHog>>> = []
const create = async (config: AnalyticsOptions = {}, storage: false | MemoryStorage = false) => {
    const requests: SentRequest[] = []
    const client = await createPostHog({
        ...options,
        storage,
        fetch: createFetch(requests),
        extensions: [analytics({ flushInterval: 0, ...config })],
    })
    clients.push(client)
    return { client, product: requireInstalledExtension(client.analytics), requests }
}

afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.dispose()))
    vi.restoreAllMocks()
})

describe('analytics person profiles', () => {
    it('keeps identity controls safe before the product has been installed', async () => {
        const product = analytics()
        expect(() => {
            product.createPersonProfile()
            product.setPersonProperties({ plan: 'paid' })
            product.unsetPersonProperties('plan')
            product.setInternalOrTestUser()
        }).not.toThrow()
        await product.dispose?.()
    })

    it('defaults to identified_only and protects the processing flag from caller properties', async () => {
        const { client, product, requests } = await create()
        product.capture('anonymous', { $process_person_profile: true })
        await product.identify('user-123')
        product.capture('identified', { $process_person_profile: false })
        await client.flush()
        expect(events(requests).map(({ event, options }) => [event, options.process_person_profile])).toEqual([
            ['anonymous', false],
            ['$identify', true],
            ['identified', true],
        ])
    })

    it('creates an anonymous profile once without marking the ID identified, and retains it across reload', async () => {
        const storage = new MemoryStorage()
        const first = await create({}, storage)
        const anonymousId = first.client.distinctId
        first.product.createPersonProfile()
        first.product.createPersonProfile()
        expect(first.client.distinctId).toBe(anonymousId)
        await first.client.flush()
        expect(events(first.requests)).toMatchObject([
            {
                event: '$set',
                distinct_id: anonymousId,
                options: { process_person_profile: true },
                properties: { $set: {}, $set_once: {} },
            },
        ])
        await first.client.dispose()

        const second = await create({}, storage)
        second.product.capture('after_reload')
        await second.product.identify('user-123')
        await second.client.flush()
        expect(events(second.requests)).toMatchObject([
            { event: 'after_reload', distinct_id: anonymousId, options: { process_person_profile: true } },
            { event: '$identify', properties: { $anon_distinct_id: anonymousId } },
        ])
        second.product.reset()
        second.product.capture('after_reset')
        await second.client.flush()
        expect(events(second.requests).at(-1)).toMatchObject({
            event: 'after_reset',
            options: { process_person_profile: false },
        })
    })

    it('retains denied explicit enablement across opt-in and repeat creation on the public root path', async () => {
        const requests: SentRequest[] = []
        const client = await createRootPostHog({
            ...options,
            storage: new MemoryStorage(),
            optOutByDefault: true,
            analytics: { flushInterval: 0 },
            flags: false,
            logs: false,
            surveys: false,
            autocapture: false,
            fetch: createFetch(requests),
        })
        clients.push(client)
        const product = requireInstalledExtension(await client.resolveExtension('analytics'))
        const identity = { distinctId: client.distinctId, anonymousId: client.anonymousId, deviceId: client.deviceId }
        const observed = vi.fn()
        product.onEvent(observed)
        product.createPersonProfile()
        product.createPersonProfile()
        await client.flush()
        expect(events(requests)).toEqual([])
        expect(observed).not.toHaveBeenCalled()
        expect(client.session).toBeUndefined()
        client.optIn()
        product.createPersonProfile()
        await client.flush()
        expect(events(requests)).toEqual([])
        expect(client.session).toBeUndefined()
        product.capture('after_opt_in')
        await client.flush()
        expect(events(requests)).toMatchObject([
            {
                event: 'after_opt_in',
                distinct_id: identity.distinctId,
                options: { process_person_profile: true },
            },
        ])
        expect(events(requests)).toHaveLength(1)
        expect({ distinctId: client.distinctId, anonymousId: client.anonymousId, deviceId: client.deviceId }).toEqual(
            identity
        )
        product.reset()
        product.createPersonProfile()
        await client.flush()
        expect(events(requests).map(({ event }) => event)).toEqual(['after_opt_in', '$set'])
    })

    it('keeps the admitted duplicate signature when an intervening identify payload is unserializable', async () => {
        const { client, product, requests } = await create()
        await product.identify('user-123', { plan: 'paid' })
        await product.identify('user-123', { amount: BigInt(1) })
        product.setPersonProperties({ plan: 'paid' })
        await client.flush()
        expect(events(requests).map(({ event }) => event)).toEqual(['$identify'])
        const serialize = vi
            .fn()
            .mockImplementationOnce(() => {
                throw new Error('unavailable')
            })
            .mockReturnValue({ plan: 'enterprise' })
        const set = { toJSON: serialize }
        await product.identify('next-user', set)
        expect(client.distinctId).toBe('next-user')
        await client.flush()
        expect(events(requests)).toHaveLength(1)
        await product.identify('next-user', set)
        product.setPersonProperties({ plan: 'enterprise' })
        await client.flush()
        expect(serialize).toHaveBeenCalledTimes(2)
        expect(events(requests).map(({ event }) => event)).toEqual(['$identify', '$set'])
        expect(events(requests).at(-1)).toMatchObject({
            distinct_id: 'next-user',
            properties: { $set: { plan: 'enterprise' } },
        })
    })

    it('processes anonymous captures in always mode and needs no explicit profile event', async () => {
        const { client, product, requests } = await create({ personProfiles: 'always' })
        product.createPersonProfile()
        product.capture('anonymous')
        await client.flush()
        expect(events(requests)).toMatchObject([{ event: 'anonymous', options: { process_person_profile: true } }])
        expect(events(requests)).toHaveLength(1)
    })

    it('suppresses person and group operations in never mode while allowing unprocessed captures', async () => {
        const { client, product, requests } = await create({ personProfiles: 'never' })
        const anonymousId = client.distinctId
        product.createPersonProfile()
        product.setPersonProperties({ email: 'test@example.com' })
        product.unsetPersonProperties('email')
        product.setInternalOrTestUser()
        await product.identify('user-123')
        await product.group('organization', 'org-123', { plan: 'paid' })
        expect(client.distinctId).toBe(anonymousId)
        expect(client.groups).toEqual({})
        product.capture('ordinary', { $process_person_profile: true })
        await client.flush()
        expect(events(requests)).toMatchObject([{ event: 'ordinary', options: { process_person_profile: false } }])
        expect(events(requests)).toHaveLength(1)
    })

    it('updates properties on the current anonymous identity and shares deduplication with identify', async () => {
        const { client, product, requests } = await create()
        const anonymousId = client.distinctId
        product.setPersonProperties({ plan: 'paid' }, { first_seen: 'today' })
        product.setPersonProperties({ plan: 'paid' }, { first_seen: 'today' })
        expect(client.distinctId).toBe(anonymousId)
        await product.identify('user-123', { plan: 'paid' }, { first_seen: 'today' })
        product.setPersonProperties({ plan: 'paid' }, { first_seen: 'today' })
        await client.flush()
        expect(events(requests).map(({ event }) => event)).toEqual(['$set', '$identify'])
        expect(events(requests)[0]).toMatchObject({
            distinct_id: anonymousId,
            properties: { $set: { plan: 'paid' }, $set_once: { first_seen: 'today' } },
            options: { process_person_profile: true },
        })
    })

    it('does not deduplicate the anonymous-to-identified transition for the same ID', async () => {
        const { client, product, requests } = await create()
        const id = client.distinctId
        product.setPersonProperties({ plan: 'paid' })
        await product.identify(id, { plan: 'paid' })
        await product.identify(id, { plan: 'paid' })
        await client.flush()
        expect(events(requests).map(({ event }) => event)).toEqual(['$set', '$set'])
        expect(client.distinctId).toBe(id)
    })

    it('enables person processing when group context is established', async () => {
        const { client, product, requests } = await create()
        await product.group('organization', 'org-123')
        product.capture('grouped')
        await client.flush()
        expect(events(requests).map(({ event, options }) => [event, options.process_person_profile])).toEqual([
            ['$groupidentify', true],
            ['grouped', true],
        ])
    })

    it('uses the default profile mode when an untyped configuration getter fails', async () => {
        const read = vi.fn((): never => {
            throw new Error('configuration unavailable')
        })
        const config: AnalyticsOptions = {
            flushInterval: 0,
            get personProfiles() {
                return read()
            },
        }
        const product = analytics(config)
        const requests: SentRequest[] = []
        const client = await createPostHog({ ...options, fetch: createFetch(requests), extensions: [product] })
        clients.push(client)
        product.capture('anonymous')
        await client.flush()
        expect(read).toHaveBeenCalledOnce()
        expect(events(requests)).toMatchObject([{ event: 'anonymous', options: { process_person_profile: false } }])
    })

    it('mirrors set, set-once and unset into local flag context without changing identity', async () => {
        const flagsExtension = flags({ featureFlagEvaluation: false })
        const requests: SentRequest[] = []
        const client = await createPostHog({
            ...options,
            fetch: createFetch(requests),
            extensions: [analytics({ flushInterval: 0 }), flagsExtension],
        })
        clients.push(client)
        const product = requireInstalledExtension(client.analytics)
        const identity = client.distinctId
        product.setPersonProperties({ plan: 'paid' }, { plan: 'free', first_seen: 'today' })
        product.setPersonProperties(undefined, { plan: 'other', first_seen: 'later' })
        const context = await client.resolveExtension<FlagsExtension>('featureFlags')
        expect(context?.getSurveyContext().personProperties).toEqual({ plan: 'paid', first_seen: 'today' })
        product.unsetPersonProperties(['plan', '', 'first_seen'])
        expect(context?.getSurveyContext().personProperties).toEqual({})
        expect(client.distinctId).toBe(identity)
        await client.flush()
        expect(events(requests).at(-1)?.properties.$unset).toEqual(['plan', 'first_seen'])
    })

    it('does not cache a property update that capture could not admit', async () => {
        const { client, product, requests } = await create()
        client.optOut()
        product.setPersonProperties({ plan: 'paid' })
        client.optIn()
        product.setPersonProperties({ plan: 'paid' })
        await client.flush()
        expect(events(requests).map(({ event }) => event)).toEqual(['$set'])
    })

    it('allows re-setting a property after unset and after reset', async () => {
        const { client, product, requests } = await create()
        product.setPersonProperties({ plan: 'paid' })
        product.unsetPersonProperties('plan')
        product.setPersonProperties({ plan: 'paid' })
        product.reset()
        product.setPersonProperties({ plan: 'paid' })
        await client.flush()
        expect(events(requests).map(({ event }) => event)).toEqual(['$set', '$set', '$set', '$set'])
        expect(events(requests)[0]?.distinct_id).not.toBe(events(requests).at(-1)?.distinct_id)
    })

    it('rejects malformed property dictionaries from untyped callers before changing processing state', async () => {
        const { client, product, requests } = await create()
        for (const value of [false, 0, '', { toJSON: () => null }, { toJSON: () => ['value'] }]) {
            expect(() => {
                // @ts-expect-error Exercise malformed dictionaries supplied by JavaScript callers.
                product.setPersonProperties(value, { valid: true })
            }).not.toThrow()
            expect(() => {
                // @ts-expect-error Exercise the independent set-once argument boundary.
                product.setPersonProperties({ valid: true }, value)
            }).not.toThrow()
        }
        product.capture('still_anonymous')
        await client.flush()
        expect(events(requests)).toMatchObject([
            { event: 'still_anonymous', options: { process_person_profile: false } },
        ])
        expect(events(requests)).toHaveLength(1)
    })

    it('unsets a single-character property name', async () => {
        const { client, product, requests } = await create()
        product.unsetPersonProperties('x')
        await client.flush()
        expect(events(requests)).toMatchObject([{ event: '$set', properties: { $unset: ['x'] } }])
    })

    it('ignores empty and non-serializable updates and marks internal users through normal person properties', async () => {
        const { client, product, requests } = await create()
        const cycle: Record<string, unknown> = {}
        cycle.self = cycle
        expect(() => product.setPersonProperties(cycle)).not.toThrow()
        product.setPersonProperties()
        product.setPersonProperties({}, {})
        product.unsetPersonProperties([])
        product.setInternalOrTestUser()
        await client.flush()
        expect(events(requests)).toMatchObject([
            { event: '$set', properties: { $set: { $internal_or_test_user: true } } },
        ])
        expect(events(requests)).toHaveLength(1)
    })

    it('keeps copied person controls bound to their owner and stops them after disposal', async () => {
        const { client, product, requests } = await create()
        const identity = { distinctId: client.distinctId, anonymousId: client.anonymousId, deviceId: client.deviceId }
        const { createPersonProfile, setPersonProperties, unsetPersonProperties, setInternalOrTestUser } = product
        const copied = { createPersonProfile, setPersonProperties, unsetPersonProperties, setInternalOrTestUser }
        copied.createPersonProfile()
        copied.setPersonProperties({ plan: 'paid' })
        copied.unsetPersonProperties(['plan'] as const)
        copied.setInternalOrTestUser()
        expect({ distinctId: client.distinctId, anonymousId: client.anonymousId, deviceId: client.deviceId }).toEqual(
            identity
        )
        await client.flush()
        expect(events(requests).map(({ event }) => event)).toEqual(['$set', '$set', '$set', '$set'])
        await client.dispose()
        expect(() => {
            copied.createPersonProfile()
            copied.setPersonProperties({ plan: 'paid' })
            copied.unsetPersonProperties('plan')
            copied.setInternalOrTestUser()
        }).not.toThrow()
        expect(events(requests)).toHaveLength(4)
    })

    it.each(['enqueue', 'sessionAdmitted'] as const)(
        'retries the same person update after %s rejects it',
        async (seam) => {
            const { client, product, requests } = await create()
            const observed = vi.fn()
            product.onEvent(observed)
            const reject =
                seam === 'enqueue'
                    ? vi.spyOn(EventBuffer.prototype, 'enqueue').mockReturnValueOnce(false)
                    : vi.spyOn(BrowserState.prototype, 'sessionAdmitted').mockReturnValueOnce(false)
            product.setPersonProperties({ plan: 'paid' })
            expect(observed).not.toHaveBeenCalled()
            expect(client.session).toBeUndefined()
            reject.mockRestore()
            product.setPersonProperties({ plan: 'paid' })
            product.setPersonProperties({ plan: 'paid' })
            await client.flush()
            expect(events(requests)).toMatchObject([{ event: '$set', properties: { $set: { plan: 'paid' } } }])
            expect(events(requests)).toHaveLength(1)
        }
    )

    it.each(['onEvent', 'onNewSession'] as const)(
        'retains a nested unset from %s before the next identical setter',
        async (notification) => {
            const { client, product, requests } = await create({ flushAt: 100 })
            if (notification === 'onNewSession') product.reset()
            let nested = false
            const unset = () => {
                if (nested) return
                nested = true
                product.unsetPersonProperties('plan')
            }
            if (notification === 'onEvent') product.onEvent(unset)
            else client.onNewSession(unset)
            product.setPersonProperties({ plan: 'paid' })
            product.setPersonProperties({ plan: 'paid' })
            await client.flush()
            expect(events(requests).map(({ properties }) => [properties.$set, properties.$unset])).toEqual([
                [{ plan: 'paid' }, undefined],
                [undefined, ['plan']],
                [{ plan: 'paid' }, undefined],
            ])
        }
    )

    it.each(['anonymous', 'same-anonymous-id', 'identified'] as const)(
        'retains a nested unset during identification from %s state',
        async (state) => {
            const { client, product, requests } = await create({ flushAt: 100 })
            if (state === 'identified') {
                await product.identify('previous-user')
                await client.flush()
                requests.length = 0
            }
            const target = state === 'same-anonymous-id' ? client.distinctId : 'next-user'
            let nested = false
            product.onEvent(() => {
                if (nested) return
                nested = true
                product.unsetPersonProperties('plan')
            })
            await product.identify(target, { plan: 'paid' })
            product.setPersonProperties({ plan: 'paid' })
            await client.flush()
            expect(events(requests)).toHaveLength(3)
            expect(
                events(requests).map(({ distinct_id, properties }) => [distinct_id, properties.$set, properties.$unset])
            ).toEqual([
                [target, { plan: 'paid' }, undefined],
                [target, undefined, ['plan']],
                [target, { plan: 'paid' }, undefined],
            ])
        }
    )

    it('does not invalidate a later admitted nested setter when an outer unset returns', async () => {
        const { client, product, requests } = await create({ flushAt: 100 })
        let nested = false
        product.onEvent(() => {
            if (nested) return
            nested = true
            product.setPersonProperties({ plan: 'paid' })
        })
        product.unsetPersonProperties('plan')
        product.setPersonProperties({ plan: 'paid' })
        await client.flush()
        expect(events(requests).map(({ properties }) => [properties.$set, properties.$unset])).toEqual([
            [undefined, ['plan']],
            [{ plan: 'paid' }, undefined],
        ])
    })

    it.each(['onEvent', 'onNewSession'] as const)(
        'deduplicates a bounded same-value reentrant setter in %s',
        async (notification) => {
            const { client, product, requests } = await create({ flushAt: 100 })
            if (notification === 'onNewSession') product.reset()
            let nested = false
            const setAgain = () => {
                if (nested) return
                nested = true
                product.setPersonProperties({ plan: 'paid' })
            }
            if (notification === 'onEvent') product.onEvent(setAgain)
            else client.onNewSession(setAgain)
            product.setPersonProperties({ plan: 'paid' })
            await client.flush()
            expect(nested).toBe(true)
            expect(events(requests)).toHaveLength(1)
            expect(events(requests)[0]).toMatchObject({ properties: { $set: { plan: 'paid' } } })
        }
    )

    it('keeps the signature of a different nested setter in admission order', async () => {
        const { client, product, requests } = await create({ flushAt: 100 })
        let nested = false
        product.onEvent(() => {
            if (nested) return
            nested = true
            product.setPersonProperties({ plan: 'free' })
        })
        product.setPersonProperties({ plan: 'paid' })
        product.setPersonProperties({ plan: 'free' })
        await client.flush()
        expect(events(requests).map(({ properties }) => properties.$set)).toEqual([{ plan: 'paid' }, { plan: 'free' }])
    })

    it.each(['enqueue', 'sessionAdmitted'] as const)(
        'keeps local invalidation from a nested unset rejected by %s',
        async (seam) => {
            const { client, product, requests } = await create({ flushAt: 100 })
            let nested = false
            product.onEvent(() => {
                if (nested) return
                nested = true
                if (seam === 'enqueue') vi.spyOn(EventBuffer.prototype, 'enqueue').mockReturnValueOnce(false)
                else vi.spyOn(BrowserState.prototype, 'sessionAdmitted').mockReturnValueOnce(false)
                product.unsetPersonProperties('plan')
            })
            product.setPersonProperties({ plan: 'paid' })
            product.setPersonProperties({ plan: 'paid' })
            await client.flush()
            expect(events(requests).map(({ properties }) => properties.$set)).toEqual([
                { plan: 'paid' },
                { plan: 'paid' },
            ])
        }
    )

    it('does not let a rejected nested setter replace the admitted outer signature', async () => {
        const { client, product, requests } = await create({ flushAt: 100 })
        let nested = false
        product.onEvent(() => {
            if (nested) return
            nested = true
            vi.spyOn(EventBuffer.prototype, 'enqueue').mockReturnValueOnce(false)
            product.setPersonProperties({ plan: 'free' })
        })
        product.setPersonProperties({ plan: 'paid' })
        product.setPersonProperties({ plan: 'paid' })
        product.setPersonProperties({ plan: 'free' })
        await client.flush()
        expect(events(requests).map(({ properties }) => properties.$set)).toEqual([{ plan: 'paid' }, { plan: 'free' }])
    })

    it('retains an admitted notification-time setter when the outer unset is rejected', async () => {
        const { client, product, requests } = await create({ flushAt: 100 })
        product.setPersonProperties({ plan: 'paid' })
        client.onIdentify(({ unset }) => {
            if (!unset) return
            product.setPersonProperties({ plan: 'free' })
            vi.spyOn(EventBuffer.prototype, 'enqueue').mockReturnValueOnce(false)
        })
        product.unsetPersonProperties('plan')
        product.setPersonProperties({ plan: 'free' })
        await client.flush()
        expect(events(requests).map(({ properties }) => properties.$set)).toEqual([{ plan: 'paid' }, { plan: 'free' }])
    })

    it('retries a property update after rate limiting without treating the attempt as admitted', async () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
        const { client, product, requests } = await create()
        for (let index = 0; index < 100; index++) product.capture('burst')
        product.setPersonProperties({ plan: 'paid' })
        now.mockReturnValue(2_000)
        product.setPersonProperties({ plan: 'paid' })
        product.setPersonProperties({ plan: 'paid' })
        await client.flush()
        expect(events(requests).filter(({ event }) => event === '$set')).toHaveLength(1)
    })

    it('does not cache a changed-user identification that emits no property event', async () => {
        const { client, product, requests } = await create()
        await product.identify('first')
        await product.identify('second')
        await product.identify('second', {})
        await client.flush()
        expect(events(requests).map(({ event }) => event)).toEqual(['$identify', '$set'])
    })

    it('snapshots person values before local notifications and before later caller mutations', async () => {
        const { client, product, requests } = await create()
        const set = { plan: { name: 'paid' } }
        const setOnce = { first: { source: 'docs' } }
        const identified = vi.fn()
        client.onIdentify(identified)
        product.setPersonProperties(set, setOnce)
        set.plan.name = 'changed'
        setOnce.first.source = 'changed'
        await client.flush()
        expect(identified).toHaveBeenCalledWith(
            expect.objectContaining({
                set: { plan: { name: 'paid' } },
                setOnce: { first: { source: 'docs' } },
            })
        )
        expect(events(requests)).toMatchObject([
            {
                properties: { $set: { plan: { name: 'paid' } }, $set_once: { first: { source: 'docs' } } },
            },
        ])
    })

    it('preserves accepted identity and processing snapshots across reset before delivery', async () => {
        const { client, product, requests } = await create()
        const anonymousId = client.distinctId
        product.capture('anonymous')
        product.createPersonProfile()
        product.capture('profile_enabled')
        product.reset()
        const resetId = client.distinctId
        product.capture('after_reset')
        await client.flush()
        expect(
            events(requests).map(({ event, distinct_id, options }) => [
                event,
                distinct_id,
                options.process_person_profile,
            ])
        ).toEqual([
            ['anonymous', anonymousId, false],
            ['$set', anonymousId, true],
            ['profile_enabled', anonymousId, true],
            ['after_reset', resetId, false],
        ])
        expect(resetId).not.toBe(anonymousId)
    })

    it('keeps explicit profile enablement in the analytics scoped store', async () => {
        const storage = new MemoryStorage()
        const { client, product } = await create({}, storage)
        product.createPersonProfile()
        const stored = JSON.parse(storage.getItem('ph_ph_person_profiles_posthog_browser_v2') ?? '{}')
        expect(stored.extensionData.analytics).toEqual({ personProcessingEnabled: true })
        expect(client.kv.get('personProcessingEnabled')).toBeUndefined()
        product.reset()
        const reset = JSON.parse(storage.getItem('ph_ph_person_profiles_posthog_browser_v2') ?? '{}')
        expect(reset.extensionData.analytics).toBeUndefined()
    })

    it('snapshots the person mode at client creation even when root acquisition is delayed', async () => {
        const requests: SentRequest[] = []
        const configuration: AnalyticsOptions = { personProfiles: 'never', flushInterval: 0 }
        const client = await createRootPostHog({
            ...options,
            analytics: configuration,
            flags: false,
            logs: false,
            surveys: false,
            autocapture: false,
            fetch: createFetch(requests),
        })
        clients.push(client)
        expect(client.analytics).toBeUndefined()
        configuration.personProfiles = 'always'
        const product = requireInstalledExtension(await client.resolveExtension('analytics'))
        await product.identify('ignored')
        product.createPersonProfile()
        product.capture('after_acquisition', { $process_person_profile: true })
        await client.flush()
        expect(events(requests)).toMatchObject([
            {
                event: 'after_acquisition',
                options: { process_person_profile: false },
            },
        ])
        expect(events(requests)).toHaveLength(1)
    })

    it.each(['capture', 'captureImmediate'] as const)(
        'protects observed and wire person policy from dynamic and serialized caller overrides in %s',
        async (method) => {
            const { client, product, requests } = await create()
            const observed = vi.fn()
            product.onEvent(observed)
            product.registerDynamicEventProperties(() => ({ $process_person_profile: true }))
            await product[method]('anonymous', { toJSON: () => ({ $process_person_profile: true }) })
            await client.flush()
            expect(observed).toHaveBeenCalledWith(
                expect.objectContaining({
                    properties: expect.objectContaining({ $process_person_profile: false }),
                })
            )
            expect(events(requests)).toMatchObject([
                {
                    event: 'anonymous',
                    options: { process_person_profile: false },
                },
            ])
            expect(events(requests)[0]?.properties).not.toHaveProperty('$process_person_profile')
        }
    )

    it('updates local flags under denied capture without caching the denied property event', async () => {
        const extension = flags({ featureFlagEvaluation: false })
        const requests: SentRequest[] = []
        const client = await createPostHog({
            ...options,
            optOutByDefault: true,
            fetch: createFetch(requests),
            extensions: [analytics({ flushInterval: 0 }), extension],
        })
        clients.push(client)
        const product = requireInstalledExtension(client.analytics)
        const context = requireInstalledExtension(await client.resolveExtension<FlagsExtension>('featureFlags'))
        const anonymousId = client.distinctId
        product.setPersonProperties({ plan: 'paid' })
        expect(context.getSurveyContext().personProperties).toEqual({ plan: 'paid' })
        product.unsetPersonProperties('plan')
        expect(context.getSurveyContext().personProperties).toEqual({})
        await client.flush()
        expect(events(requests)).toEqual([])
        expect(client.session).toBeUndefined()
        expect(client.distinctId).toBe(anonymousId)
        client.optIn()
        product.setPersonProperties({ plan: 'paid' })
        await client.flush()
        expect(events(requests)).toHaveLength(1)
        expect(events(requests)).toMatchObject([
            {
                event: '$set',
                options: { process_person_profile: true },
                properties: { $set: { plan: 'paid' } },
            },
        ])
    })

    it('leaves identity and flag notifications unchanged for person and group controls in never mode', async () => {
        const client = await createPostHog({
            ...options,
            fetch: false,
            extensions: [
                analytics({ personProfiles: 'never', flushInterval: 0 }),
                flags({ featureFlagEvaluation: false }),
            ],
        })
        clients.push(client)
        const product = requireInstalledExtension(client.analytics)
        const context = requireInstalledExtension(await client.resolveExtension<FlagsExtension>('featureFlags'))
        const before = context.getSurveyContext().personProperties
        const identified = vi.fn()
        const grouped = vi.fn()
        client.onIdentify(identified)
        client.onGroup(grouped)
        product.setPersonProperties({ plan: 'paid' })
        product.unsetPersonProperties('plan')
        await product.identify('ignored')
        await product.group('company', 'ignored', { plan: 'paid' })
        expect(context.getSurveyContext().personProperties).toEqual(before)
        expect(identified).not.toHaveBeenCalled()
        expect(grouped).not.toHaveBeenCalled()
    })
})
