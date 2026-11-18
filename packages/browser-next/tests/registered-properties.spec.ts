import type { AnalyticsOptions } from '../src/core/types'
import { group, groupIdentify, resetGroups } from '../src/products/analytics/groups'
import { alias } from '../src/products/analytics/person'
import { BrowserState } from '../src/core/state/state'
import { createPostHog } from '../src/composition/npm/core'
import { createFetch, localRemoteConfig, MemoryStorage, requireInstalledExtension, type SentRequest } from './helpers'

const options = {
    projectToken: 'ph_registered_properties',
    storage: false,
    navigator: false,
    capturePageview: false,
    remoteConfig: localRemoteConfig,
} as const

interface Event {
    event: string
    properties: Record<string, unknown>
    options: { process_person_profile: boolean }
}
const events = (requests: SentRequest[]): Event[] =>
    requests.flatMap((request) => (request.body?.batch ?? []) as Event[])
const clients: Array<Awaited<ReturnType<typeof createPostHog>>> = []
const create = async (
    storage: false | MemoryStorage = false,
    config: AnalyticsOptions = {},
    projectToken: string = options.projectToken
) => {
    const requests: SentRequest[] = []
    const client = await createPostHog({
        ...options,
        storage,
        projectToken,
        fetch: createFetch(requests),
        analytics: { flushInterval: 0, ...config },
    })
    clients.push(client)
    return { client, requests }
}
afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.dispose()))
    vi.restoreAllMocks()
})

describe('registered analytics properties', () => {
    it('merges locally without creating a session or emitting an event', async () => {
        const { client, requests } = await create()
        const observed = vi.fn()
        client.onEvent(observed)
        client.register({ plan: 'free', region: 'eu' })
        client.register({ plan: 'pro' })
        expect(client.getProperty('plan')).toBe('pro')
        expect(client.getProperty('region')).toBe('eu')
        expect(client.session).toBeUndefined()
        expect(requests).toHaveLength(0)
        expect(observed).not.toHaveBeenCalled()
        client.capture('dashboard')
        await client.flush()
        expect(events(requests)).toMatchObject([
            {
                event: 'dashboard',
                properties: { plan: 'pro', region: 'eu' },
                options: { process_person_profile: false },
            },
        ])
    })

    it.each(['capture', 'captureImmediate'] as const)(
        '%s lets dynamic and caller values override persistent values while protecting SDK metadata',
        async (method) => {
            const { client, requests } = await create()
            const observed: Record<string, unknown>[] = []
            client.onEvent(({ properties }) => observed.push(properties))
            const incorrect = {
                token: 'incorrect',
                distinct_id: 'incorrect',
                $device_id: 'incorrect',
                $groups: { organization: 'incorrect' },
                $session_id: 'incorrect',
                $window_id: 'incorrect',
                $lib: 'incorrect',
                $lib_version: 'incorrect',
                $process_person_profile: true,
            }
            client.register({ ...incorrect, plan: 'registered', region: 'eu', tier: 'registered' })
            client.registerDynamicEventProperties(() => ({ ...incorrect, plan: 'dynamic', tier: 'dynamic' }))
            await client[method]('dashboard', { ...incorrect, plan: 'event' })
            await client.flush()
            expect(events(requests)).toMatchObject([
                {
                    properties: { plan: 'event', region: 'eu', tier: 'dynamic' },
                    options: { process_person_profile: false },
                },
            ])
            expect(observed).toMatchObject([
                {
                    plan: 'event',
                    region: 'eu',
                    tier: 'dynamic',
                    token: options.projectToken,
                    distinct_id: client.distinctId,
                    $device_id: client.deviceId,
                    $groups: {},
                    $session_id: client.session?.sessionId,
                    $window_id: client.session?.windowId,
                    $lib: 'web',
                    $process_person_profile: false,
                },
            ])
            expect(requireInstalledExtension(observed[0]).$lib_version).not.toBe('incorrect')
        }
    )

    it('stamps identified processing policy over a registered false value', async () => {
        const { client, requests } = await create()
        const observed: Record<string, unknown>[] = []
        client.onEvent(({ properties }) => observed.push(properties))
        client.register({ $process_person_profile: false })
        client.identify('user-123')
        client.capture('identified', { $process_person_profile: false })
        await client.flush()
        expect(events(requests)).toMatchObject([
            { event: '$identify', options: { process_person_profile: true } },
            { event: 'identified', options: { process_person_profile: true } },
        ])
        expect(observed).toMatchObject([{ $process_person_profile: true }, { $process_person_profile: true }])
    })

    it('registers first values once and retains existing falsy values', async () => {
        const { client, requests } = await create()
        client.register({ zero: 0, empty: '', disabled: false, nullable: null })
        client.registerOnce({ plan: 'first', zero: 9, empty: 'changed', disabled: true, nullable: 'changed' })
        client.registerOnce({ plan: 'second', region: 'eu' })
        expect(client.getProperty('plan')).toBe('first')
        expect(client.getProperty('zero')).toBe(0)
        expect(client.getProperty('empty')).toBe('')
        expect(client.getProperty('disabled')).toBe(false)
        expect(client.getProperty('nullable')).toBeNull()
        expect(client.getProperty('region')).toBe('eu')
        expect(client.session).toBeUndefined()
        expect(requests).toHaveLength(0)
        client.capture('first_values')
        await client.flush()
        expect(events(requests)).toMatchObject([{ properties: { plan: 'first', region: 'eu', zero: 0 } }])
    })

    it('does not write storage for once-only registration without additions or missing-key removal', async () => {
        const storage = new MemoryStorage()
        const { client } = await create(storage)
        client.registerOnce({ plan: 'first' })
        const write = vi.spyOn(storage, 'setItem')
        client.registerOnce({ plan: 'second' })
        client.registerOnce({})
        client.unregister('missing')
        expect(write).not.toHaveBeenCalled()
        expect(client.getProperty('plan')).toBe('first')
    })

    it('replaces the default or explicit sentinel using strict equality', async () => {
        const { client } = await create()
        client.register({ plan: 'None', retries: 0, stringZero: '0', nullable: null })
        client.registerOnce({ plan: 'pro' })
        client.registerOnce({ retries: 3, stringZero: 'changed' }, 0)
        client.registerOnce({ nullable: 'known' }, null)
        expect(client.getProperty('plan')).toBe('pro')
        expect(client.getProperty('retries')).toBe(3)
        expect(client.getProperty('stringZero')).toBe('0')
        expect(client.getProperty('nullable')).toBe('known')
    })

    it('preserves once-only properties across reload and handles own prototype-named keys', async () => {
        const storage = new MemoryStorage()
        const first = await create(storage)
        first.client.registerOnce(
            JSON.parse('{"__proto__":{"own":true},"constructor":"application","prototype":"own","plan":"first"}')
        )
        await first.client.dispose()
        const second = await create(storage)
        second.client.registerOnce(
            JSON.parse('{"__proto__":"changed","constructor":"changed","prototype":"changed","plan":"second"}')
        )
        expect(second.client.getProperty('__proto__')).toEqual({ own: true })
        expect(second.client.getProperty('constructor')).toBe('application')
        expect(second.client.getProperty('prototype')).toBe('own')
        expect(second.client.getProperty('plan')).toBe('first')
        second.client.reset()
        second.client.registerOnce({ plan: 'after_reset' })
        expect(second.client.getProperty('plan')).toBe('after_reset')
    })

    it('persists updates and single-key removals across fresh instances', async () => {
        const storage = new MemoryStorage()
        const first = await create(storage)
        first.client.register({ plan: 'pro', region: 'eu' })
        first.client.unregister('plan')
        await first.client.dispose()
        const second = await create(storage)
        expect(second.client.getProperty('plan')).toBeUndefined()
        expect(second.client.getProperty('region')).toBe('eu')
        second.client.capture('loaded')
        await second.client.flush()
        expect(events(second.requests)[0]?.properties.region).toBe('eu')
        expect(events(second.requests)[0]?.properties).not.toHaveProperty('plan')
    })

    it('snapshots registration and getter values and handles own prototype-named keys', async () => {
        const { client } = await create()
        const nested = { count: 1 }
        client.register({ nested, '': 'empty', nullable: null })
        client.register(JSON.parse('{"__proto__":{"own":true},"constructor":"application"}'))
        nested.count = 2
        const read = client.getProperty('nested') as { count: number }
        expect(read).toEqual({ count: 1 })
        read.count = 3
        expect(client.getProperty('nested')).toEqual({ count: 1 })
        expect(client.getProperty('__proto__')).toEqual({ own: true })
        expect(client.getProperty('constructor')).toBe('application')
        expect(client.getProperty('toString')).toBeUndefined()
        expect(client.getProperty('nullable')).toBeNull()
        expect(client.getProperty('')).toBe('empty')
        client.unregister('__proto__')
        client.unregister('')
        expect(client.getProperty('__proto__')).toBeUndefined()
        expect(client.getProperty('')).toBeUndefined()
        expect(({} as Record<string, unknown>).own).toBeUndefined()
    })

    it.each(['register', 'registerOnce'] as const)(
        'contains invalid %s inputs and serialization failures without replacing valid properties',
        async (method) => {
            const { client, requests } = await create()
            client.register({ retained: true })
            const cycle: Record<string, unknown> = {}
            cycle.self = cycle
            const revoked = Proxy.revocable({ plan: 'pro' }, {})
            revoked.revoke()
            const invalid: unknown[] = [
                null,
                [],
                'wrong',
                undefined,
                cycle,
                { toJSON: () => [] },
                { toJSON: () => null },
                { toJSON: () => undefined },
                {
                    toJSON() {
                        throw new Error('serialization failed')
                    },
                },
                { value: 1n },
                revoked.proxy,
            ]
            for (const value of invalid) {
                expect(() => {
                    // @ts-expect-error Exercise malformed values from JavaScript callers.
                    client[method](value)
                }).not.toThrow()
            }
            expect(() =>
                client[method]({
                    get broken() {
                        throw new Error('property getter failed')
                    },
                })
            ).not.toThrow()
            expect(client.getProperty('retained')).toBe(true)
            client.capture('valid')
            await client.flush()
            expect(events(requests)[0]?.properties.retained).toBe(true)
            expect(events(requests)[0]?.properties).not.toHaveProperty('self')
        }
    )

    it('keeps queued events immutable and leaves other keys when unregistering', async () => {
        const { client, requests } = await create()
        client.register({ plan: 'before', region: 'eu' })
        client.capture('before')
        client.register({ plan: 'after' })
        client.unregister('region')
        client.unregister('missing')
        client.capture('after')
        await client.flush()
        expect(events(requests)).toMatchObject([
            { event: 'before', properties: { plan: 'before', region: 'eu' } },
            { event: 'after', properties: { plan: 'after' } },
        ])
        expect(events(requests)[1]?.properties).not.toHaveProperty('region')
    })

    it('enriches identity operations and survives group-only cleanup but not full reset', async () => {
        const { client, requests } = await create()
        client.register({ context: 'application' })
        alias(client, 'account')
        client.identify('member')
        group(client, 'organization', 'current')
        groupIdentify(client, 'organization', 'other')
        resetGroups(client)
        expect(client.getProperty('context')).toBe('application')
        await client.flush()
        expect(events(requests)).toHaveLength(4)
        for (const event of events(requests)) expect(event.properties.context).toBe('application')
        client.reset()
        expect(client.getProperty('context')).toBeUndefined()
        client.capture('reset')
        await client.flush()
        expect(events(requests).at(-1)?.properties).not.toHaveProperty('context')
    })

    it('allows local context changes while capture is denied and sends only after consent', async () => {
        const { client, requests } = await create()
        client.optOut()
        client.register({ plan: 'pro', removed: true })
        client.unregister('removed')
        client.capture('denied')
        await client.flush()
        expect(requests).toHaveLength(0)
        expect(client.getProperty('plan')).toBe('pro')
        client.optIn()
        client.capture('allowed')
        await client.flush()
        expect(events(requests)).toMatchObject([{ event: 'allowed', properties: { plan: 'pro' } }])
        expect(events(requests)).toHaveLength(1)
    })

    it('keeps registration on a disposed client inert', async () => {
        const { client } = await create()
        client.register({ retained: true })
        await client.dispose()
        expect(() => {
            client.register({ after: true })
            client.registerOnce({ after: true })
            client.unregister('retained')
        }).not.toThrow()
        expect(client.getProperty('retained')).toBeUndefined()
    })

    it('keeps existing values when an empty registration is merged', async () => {
        const { client } = await create()
        client.register({})
        expect(client.getProperty('plan')).toBeUndefined()
        client.register({ plan: 'pro', nested: { count: 1 } })
        client.register({})
        client.register({ plan: 'pro' })
        expect(client.getProperty('plan')).toBe('pro')
        expect(client.getProperty('nested')).toEqual({ count: 1 })
    })

    it('uses strict sentinel equality for booleans, empty strings and object values', async () => {
        const { client } = await create()
        const sentinel = { initial: true }
        client.register({ disabled: false, empty: '', object: sentinel, stringFalse: 'false' })
        client.registerOnce({ disabled: 'enabled', stringFalse: 'changed' }, false)
        client.registerOnce({ empty: 'filled' }, '')
        client.registerOnce({ object: 'changed' }, sentinel)
        expect(client.getProperty('disabled')).toBe('enabled')
        expect(client.getProperty('empty')).toBe('filled')
        expect(client.getProperty('stringFalse')).toBe('false')
        expect(client.getProperty('object')).toEqual({ initial: true })
    })

    it('captures own prototype-named properties without affecting object prototypes', async () => {
        const { client, requests } = await create()
        client.register(
            JSON.parse('{"__proto__":{"registered":true},"constructor":"registered","prototype":"registered"}')
        )
        client.capture('registered_keys')
        client.capture(
            'caller_keys',
            JSON.parse('{"__proto__":{"caller":true},"constructor":"caller","prototype":"caller"}')
        )
        await client.flush()
        const registered = requireInstalledExtension(events(requests)[0]).properties
        const caller = requireInstalledExtension(events(requests)[1]).properties
        expect(Object.prototype.hasOwnProperty.call(registered, '__proto__')).toBe(true)
        expect(registered['__proto__']).toEqual({ registered: true })
        expect(registered.constructor).toBe('registered')
        expect(registered.prototype).toBe('registered')
        expect(Object.prototype.hasOwnProperty.call(caller, '__proto__')).toBe(true)
        expect(caller['__proto__']).toEqual({ caller: true })
        expect(caller.constructor).toBe('caller')
        expect(caller.prototype).toBe('caller')
        client.unregister('constructor')
        client.unregister('prototype')
        expect(client.getProperty('constructor')).toBeUndefined()
        expect(client.getProperty('prototype')).toBeUndefined()
        expect(({} as Record<string, unknown>).registered).toBeUndefined()
        expect(({} as Record<string, unknown>).caller).toBeUndefined()
    })

    it.each(['capture', 'captureImmediate'] as const)(
        '%s snapshots persistent, dynamic, caller and option values once before later mutations',
        async (method) => {
            const { client, requests } = await create()
            const stored = { count: 1 }
            const dynamic = { count: 2 }
            const caller = { count: 3 }
            const setValue = { count: 4 }
            const setOnceValue = { count: 5 }
            const toJSON = vi.fn(() => caller)
            const stamp = new Date('2025-01-02T03:04:05.000Z')
            client.register({ stored, plan: 'persistent', tier: 'persistent', $set: { wrong: true } })
            client.registerDynamicEventProperties(() => ({ dynamic, plan: 'dynamic', tier: 'dynamic' }))
            const observed: Record<string, unknown>[] = []
            client.onEvent(({ properties }) => observed.push(properties))
            const pending = client[method](
                'snapshot',
                { plan: 'caller', caller: { toJSON }, $set_once: { wrong: true } },
                {
                    uuid: 'registered-snapshot',
                    timestamp: stamp,
                    set: { setValue },
                    setOnce: { setOnceValue },
                }
            )
            stored.count = 9
            dynamic.count = 9
            caller.count = 9
            setValue.count = 9
            setOnceValue.count = 9
            stamp.setUTCFullYear(2030)
            client.register({ stored: { count: 9 }, plan: 'later' })
            client.unregister('tier')
            await pending
            await client.flush()
            expect(toJSON).toHaveBeenCalledTimes(1)
            const expected = {
                stored: { count: 1 },
                dynamic: { count: 2 },
                caller: { count: 3 },
                plan: 'caller',
                tier: 'dynamic',
                $set: { setValue: { count: 4 } },
                $set_once: { setOnceValue: { count: 5 } },
            }
            expect(observed).toMatchObject([expected])
            expect(Object.isFrozen(requireInstalledExtension(observed[0]).stored)).toBe(true)
            expect(events(requests)).toMatchObject([
                {
                    event: 'snapshot',
                    uuid: 'registered-snapshot',
                    timestamp: '2025-01-02T03:04:05.000Z',
                    properties: expected,
                },
            ])
        }
    )

    it('stores the superProperties record in the client key-value namespace', async () => {
        const storage = new MemoryStorage()
        const { client } = await create(storage)
        client.register({ plan: 'pro', nested: { count: 1 } })
        const raw = requireInstalledExtension(
            storage.getItem(`ph_${options.projectToken}_posthog_browser_v2`) ?? undefined
        )
        expect(JSON.parse(raw)).toMatchObject({
            extensionData: { core: { superProperties: { plan: 'pro', nested: { count: 1 } } } },
        })
        const other = await create(storage, {}, 'ph_other_project')
        expect(other.client.getProperty('plan')).toBeUndefined()
        other.client.register({ plan: 'other' })
        const fresh = await create(storage)
        expect(fresh.client.getProperty('plan')).toBe('pro')
    })

    it('keeps local registration independent of consent and never-mode person processing', async () => {
        const { client, requests } = await create(false, { personProfiles: 'never' })
        client.optOut()
        client.registerOnce({ plan: 'pro', removed: true })
        client.unregister('removed')
        expect(client.getProperty('plan')).toBe('pro')
        client.capture('denied')
        expect(client.session).toBeUndefined()
        expect(requests).toHaveLength(0)
        client.optIn()
        client.capture('allowed')
        await client.flush()
        expect(events(requests)).toMatchObject([
            { event: 'allowed', properties: { plan: 'pro' }, options: { process_person_profile: false } },
        ])
    })

    it.each(['register', 'registerOnce'] as const)(
        '%s serializes caller values once and merges after reentrant local mutations',
        async (method) => {
            const { client } = await create()
            client.register({ retained: true, removed: true })
            const toJSON = vi.fn(() => {
                client.unregister('removed')
                client.register({ nestedOperation: true })
                return { caller: { count: 1 } }
            })
            client[method]({ toJSON })
            expect(toJSON).toHaveBeenCalledTimes(1)
            expect(client.getProperty('retained')).toBe(true)
            expect(client.getProperty('removed')).toBeUndefined()
            expect(client.getProperty('nestedOperation')).toBe(true)
            expect(client.getProperty('caller')).toEqual({ count: 1 })
        }
    )

    it.each(['register', 'registerOnce'] as const)(
        '%s does not evaluate inputs when state is unavailable and rechecks state after serialization',
        async (method) => {
            const { client } = await create()
            const prepare = vi.spyOn(BrowserState.prototype, 'prepare').mockReturnValue(false)
            const skipped = vi.fn(() => ({ skipped: true }))
            client[method]({ toJSON: skipped })
            expect(skipped).not.toHaveBeenCalled()
            expect(client.getProperty('skipped')).toBeUndefined()
            prepare.mockReturnValue(true)
            const toJSON = vi.fn(() => {
                prepare.mockReturnValue(false)
                return { late: true }
            })
            client[method]({ toJSON })
            expect(toJSON).toHaveBeenCalledTimes(1)
            prepare.mockRestore()
            expect(client.getProperty('late')).toBeUndefined()
        }
    )

    it.each(['capture', 'captureImmediate'] as const)(
        '%s ignores root caller serializer functions without discarding merged context',
        async (method) => {
            const { client, requests } = await create()
            client.register({ persistent: true })
            client.registerDynamicEventProperties(() => ({ dynamic: true }))
            const toJSON = vi.fn(() => ({ custom: true }))
            await client[method]('serialized', { caller: true, toJSON })
            await client.flush()
            expect(toJSON).not.toHaveBeenCalled()
            expect(events(requests)).toMatchObject([
                { event: 'serialized', properties: { persistent: true, dynamic: true, caller: true } },
            ])
            expect(events(requests)[0]?.properties).not.toHaveProperty('toJSON')
        }
    )

    it('clears future context on full reset without rewriting queued properties', async () => {
        const { client, requests } = await create()
        client.register({ context: { account: 'before' } })
        client.capture('before_reset')
        client.reset()
        expect(client.getProperty('context')).toBeUndefined()
        client.capture('after_reset')
        await client.flush()
        expect(events(requests)).toMatchObject([
            { event: 'before_reset', properties: { context: { account: 'before' } } },
            { event: 'after_reset' },
        ])
        expect(requireInstalledExtension(events(requests)[1]).properties).not.toHaveProperty('context')
    })

    it.each(['register', 'registerOnce'] as const)(
        '%s rechecks client mutation authority after caller serialization starts disposal',
        async (method) => {
            const storage = new MemoryStorage()
            const first = await create(storage)
            first.client.register({ retained: true })
            const pending: Promise<void>[] = []
            first.client[method]({
                toJSON() {
                    pending.push(first.client.dispose())
                    return { late: true }
                },
            })
            await Promise.all(pending)
            const fresh = await create(storage)
            expect(fresh.client.getProperty('retained')).toBe(true)
            expect(fresh.client.getProperty('late')).toBeUndefined()
        }
    )

    it.each(['capture', 'captureImmediate'] as const)(
        '%s retains its property snapshot when caller serialization changes registration',
        async (method) => {
            const { client, requests } = await create()
            client.register({ context: { count: 1 } })
            const toJSON = vi.fn(() => {
                client.register({ context: { count: 2 } })
                return { caller: true }
            })
            await client[method]('reentrant_snapshot', { converted: { toJSON } })
            await client.flush()
            expect(toJSON).toHaveBeenCalledTimes(1)
            expect(events(requests)).toMatchObject([
                { properties: { context: { count: 1 }, converted: { caller: true } } },
            ])
            expect(client.getProperty('context')).toEqual({ count: 2 })
        }
    )

    it('retains local properties when persistence fails and saves them on a later update', async () => {
        const storage = new MemoryStorage()
        const { client } = await create(storage)
        const write = vi.spyOn(storage, 'setItem').mockImplementation(() => {
            throw new Error('storage unavailable')
        })
        expect(() => client.register({ first: { count: 1 } })).not.toThrow()
        expect(client.getProperty('first')).toEqual({ count: 1 })
        write.mockRestore()
        client.register({ second: true })
        const fresh = await create(storage)
        expect(fresh.client.getProperty('first')).toEqual({ count: 1 })
        expect(fresh.client.getProperty('second')).toBe(true)
    })
})
