import { analytics, type AnalyticsOptions } from '../src/analytics'
import { BrowserState } from '../src/state'
import { createPostHog } from '../src/core'
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
        extensions: [analytics({ flushInterval: 0, ...config })],
    })
    clients.push(client)
    return { client, product: requireInstalledExtension(client.analytics), requests }
}
afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.dispose()))
    vi.restoreAllMocks()
})

describe('registered analytics properties', () => {
    it('merges locally without creating a session or emitting an event', async () => {
        const { client, product, requests } = await create()
        const observed = vi.fn()
        product.onEvent(observed)
        product.register({ plan: 'free', region: 'eu' })
        product.register({ plan: 'pro' })
        expect(product.getProperty('plan')).toBe('pro')
        expect(product.getProperty('region')).toBe('eu')
        expect(client.session).toBeUndefined()
        expect(requests).toHaveLength(0)
        expect(observed).not.toHaveBeenCalled()
        product.capture('dashboard')
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
            const { client, product, requests } = await create()
            const observed: Record<string, unknown>[] = []
            product.onEvent(({ properties }) => observed.push(properties))
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
            product.register({ ...incorrect, plan: 'registered', region: 'eu', tier: 'registered' })
            product.registerDynamicEventProperties(() => ({ ...incorrect, plan: 'dynamic', tier: 'dynamic' }))
            await product[method]('dashboard', { ...incorrect, plan: 'event' })
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
        const { client, product, requests } = await create()
        const observed: Record<string, unknown>[] = []
        product.onEvent(({ properties }) => observed.push(properties))
        product.register({ $process_person_profile: false })
        await product.identify('user-123')
        product.capture('identified', { $process_person_profile: false })
        await client.flush()
        expect(events(requests)).toMatchObject([
            { event: '$identify', options: { process_person_profile: true } },
            { event: 'identified', options: { process_person_profile: true } },
        ])
        expect(observed).toMatchObject([{ $process_person_profile: true }, { $process_person_profile: true }])
    })

    it('registers first values once and retains existing falsy values', async () => {
        const { product, client, requests } = await create()
        product.register({ zero: 0, empty: '', disabled: false, nullable: null })
        product.registerOnce({ plan: 'first', zero: 9, empty: 'changed', disabled: true, nullable: 'changed' })
        product.registerOnce({ plan: 'second', region: 'eu' })
        expect(product.getProperty('plan')).toBe('first')
        expect(product.getProperty('zero')).toBe(0)
        expect(product.getProperty('empty')).toBe('')
        expect(product.getProperty('disabled')).toBe(false)
        expect(product.getProperty('nullable')).toBeNull()
        expect(product.getProperty('region')).toBe('eu')
        expect(client.session).toBeUndefined()
        expect(requests).toHaveLength(0)
        product.capture('first_values')
        await client.flush()
        expect(events(requests)).toMatchObject([{ properties: { plan: 'first', region: 'eu', zero: 0 } }])
    })

    it('does not write storage for once-only registration without additions or missing-key removal', async () => {
        const storage = new MemoryStorage()
        const { product } = await create(storage)
        product.registerOnce({ plan: 'first' })
        const write = vi.spyOn(storage, 'setItem')
        product.registerOnce({ plan: 'second' })
        product.registerOnce({})
        product.unregister('missing')
        expect(write).not.toHaveBeenCalled()
        expect(product.getProperty('plan')).toBe('first')
    })

    it('replaces the default or explicit sentinel using strict equality', async () => {
        const { product } = await create()
        product.register({ plan: 'None', retries: 0, stringZero: '0', nullable: null })
        product.registerOnce({ plan: 'pro' })
        product.registerOnce({ retries: 3, stringZero: 'changed' }, 0)
        product.registerOnce({ nullable: 'known' }, null)
        expect(product.getProperty('plan')).toBe('pro')
        expect(product.getProperty('retries')).toBe(3)
        expect(product.getProperty('stringZero')).toBe('0')
        expect(product.getProperty('nullable')).toBe('known')
    })

    it('preserves once-only properties across reload and handles own prototype-named keys', async () => {
        const storage = new MemoryStorage()
        const first = await create(storage)
        first.product.registerOnce(
            JSON.parse('{"__proto__":{"own":true},"constructor":"application","prototype":"own","plan":"first"}')
        )
        await first.client.dispose()
        const second = await create(storage)
        second.product.registerOnce(
            JSON.parse('{"__proto__":"changed","constructor":"changed","prototype":"changed","plan":"second"}')
        )
        expect(second.product.getProperty('__proto__')).toEqual({ own: true })
        expect(second.product.getProperty('constructor')).toBe('application')
        expect(second.product.getProperty('prototype')).toBe('own')
        expect(second.product.getProperty('plan')).toBe('first')
        second.product.reset()
        second.product.registerOnce({ plan: 'after_reset' })
        expect(second.product.getProperty('plan')).toBe('after_reset')
    })

    it('persists updates and single-key removals across fresh instances', async () => {
        const storage = new MemoryStorage()
        const first = await create(storage)
        first.product.register({ plan: 'pro', region: 'eu' })
        first.product.unregister('plan')
        await first.client.dispose()
        const second = await create(storage)
        expect(second.product.getProperty('plan')).toBeUndefined()
        expect(second.product.getProperty('region')).toBe('eu')
        second.product.capture('loaded')
        await second.client.flush()
        expect(events(second.requests)[0]?.properties.region).toBe('eu')
        expect(events(second.requests)[0]?.properties).not.toHaveProperty('plan')
    })

    it('snapshots registration and getter values and handles own prototype-named keys', async () => {
        const { product } = await create()
        const nested = { count: 1 }
        product.register({ nested, '': 'empty', nullable: null })
        product.register(JSON.parse('{"__proto__":{"own":true},"constructor":"application"}'))
        nested.count = 2
        const read = product.getProperty('nested') as { count: number }
        expect(read).toEqual({ count: 1 })
        read.count = 3
        expect(product.getProperty('nested')).toEqual({ count: 1 })
        expect(product.getProperty('__proto__')).toEqual({ own: true })
        expect(product.getProperty('constructor')).toBe('application')
        expect(product.getProperty('toString')).toBeUndefined()
        expect(product.getProperty('nullable')).toBeNull()
        expect(product.getProperty('')).toBe('empty')
        product.unregister('__proto__')
        product.unregister('')
        expect(product.getProperty('__proto__')).toBeUndefined()
        expect(product.getProperty('')).toBeUndefined()
        expect(({} as Record<string, unknown>).own).toBeUndefined()
    })

    it.each(['register', 'registerOnce'] as const)(
        'contains invalid %s inputs and serialization failures without replacing valid properties',
        async (method) => {
            const { client, product, requests } = await create()
            product.register({ retained: true })
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
                    product[method](value)
                }).not.toThrow()
            }
            expect(() =>
                product[method]({
                    get broken() {
                        throw new Error('property getter failed')
                    },
                })
            ).not.toThrow()
            expect(product.getProperty('retained')).toBe(true)
            product.capture('valid')
            await client.flush()
            expect(events(requests)[0]?.properties.retained).toBe(true)
            expect(events(requests)[0]?.properties).not.toHaveProperty('self')
        }
    )

    it('keeps queued events immutable and leaves other keys when unregistering', async () => {
        const { client, product, requests } = await create()
        product.register({ plan: 'before', region: 'eu' })
        product.capture('before')
        product.register({ plan: 'after' })
        product.unregister('region')
        product.unregister('missing')
        product.capture('after')
        await client.flush()
        expect(events(requests)).toMatchObject([
            { event: 'before', properties: { plan: 'before', region: 'eu' } },
            { event: 'after', properties: { plan: 'after' } },
        ])
        expect(events(requests)[1]?.properties).not.toHaveProperty('region')
    })

    it('enriches identity operations and survives group-only cleanup but not full reset', async () => {
        const { client, product, requests } = await create()
        product.register({ context: 'application' })
        product.alias('account')
        await product.identify('member')
        await product.group('organization', 'current')
        product.groupIdentify('organization', 'other')
        product.resetGroups()
        expect(product.getProperty('context')).toBe('application')
        await client.flush()
        expect(events(requests)).toHaveLength(4)
        for (const event of events(requests)) expect(event.properties.context).toBe('application')
        product.reset()
        expect(product.getProperty('context')).toBeUndefined()
        product.capture('reset')
        await client.flush()
        expect(events(requests).at(-1)?.properties).not.toHaveProperty('context')
    })

    it('allows local context changes while capture is denied and sends only after consent', async () => {
        const { client, product, requests } = await create()
        client.optOut()
        product.register({ plan: 'pro', removed: true })
        product.unregister('removed')
        product.capture('denied')
        await client.flush()
        expect(requests).toHaveLength(0)
        expect(product.getProperty('plan')).toBe('pro')
        client.optIn()
        product.capture('allowed')
        await client.flush()
        expect(events(requests)).toMatchObject([{ event: 'allowed', properties: { plan: 'pro' } }])
        expect(events(requests)).toHaveLength(1)
    })

    it.each(['register', 'registerOnce'] as const)(
        'does not persist %s when input serialization disposes the product',
        async (method) => {
            const storage = new MemoryStorage()
            const first = await create(storage)
            first.product.register({ retained: true })
            const disposing: Promise<void>[] = []
            first.product[method]({
                toJSON() {
                    disposing.push(Promise.resolve(first.product.dispose?.()))
                    return { late: true }
                },
            })
            await Promise.all(disposing)
            const second = await create(storage)
            expect(second.product.getProperty('retained')).toBe(true)
            expect(second.product.getProperty('late')).toBeUndefined()
        }
    )

    it('keeps uninstalled and retained disposed handles inert', async () => {
        const raw = analytics()
        expect(() => {
            raw.register({ unused: true })
            raw.registerOnce({ unused: true })
            raw.unregister('unused')
        }).not.toThrow()
        expect(raw.getProperty('unused')).toBeUndefined()
        await raw.dispose?.()
        const { client, product } = await create()
        product.register({ retained: true })
        await client.dispose()
        expect(() => {
            product.register({ after: true })
            product.registerOnce({ after: true })
            product.unregister('retained')
        }).not.toThrow()
        expect(product.getProperty('retained')).toBeUndefined()
    })

    it('keeps existing values when an empty registration is merged', async () => {
        const { product } = await create()
        product.register({})
        expect(product.getProperty('plan')).toBeUndefined()
        product.register({ plan: 'pro', nested: { count: 1 } })
        product.register({})
        product.register({ plan: 'pro' })
        expect(product.getProperty('plan')).toBe('pro')
        expect(product.getProperty('nested')).toEqual({ count: 1 })
    })

    it('uses strict sentinel equality for booleans, empty strings and object values', async () => {
        const { product } = await create()
        const sentinel = { initial: true }
        product.register({ disabled: false, empty: '', object: sentinel, stringFalse: 'false' })
        product.registerOnce({ disabled: 'enabled', stringFalse: 'changed' }, false)
        product.registerOnce({ empty: 'filled' }, '')
        product.registerOnce({ object: 'changed' }, sentinel)
        expect(product.getProperty('disabled')).toBe('enabled')
        expect(product.getProperty('empty')).toBe('filled')
        expect(product.getProperty('stringFalse')).toBe('false')
        expect(product.getProperty('object')).toEqual({ initial: true })
    })

    it('captures own prototype-named properties without affecting object prototypes', async () => {
        const { client, product, requests } = await create()
        product.register(
            JSON.parse('{"__proto__":{"registered":true},"constructor":"registered","prototype":"registered"}')
        )
        product.capture('registered_keys')
        product.capture(
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
        product.unregister('constructor')
        product.unregister('prototype')
        expect(product.getProperty('constructor')).toBeUndefined()
        expect(product.getProperty('prototype')).toBeUndefined()
        expect(({} as Record<string, unknown>).registered).toBeUndefined()
        expect(({} as Record<string, unknown>).caller).toBeUndefined()
    })

    it.each(['capture', 'captureImmediate'] as const)(
        '%s snapshots persistent, dynamic, caller and option values once before later mutations',
        async (method) => {
            const { client, product, requests } = await create()
            const stored = { count: 1 }
            const dynamic = { count: 2 }
            const caller = { count: 3 }
            const setValue = { count: 4 }
            const setOnceValue = { count: 5 }
            const toJSON = vi.fn(() => caller)
            const stamp = new Date('2025-01-02T03:04:05.000Z')
            product.register({ stored, plan: 'persistent', tier: 'persistent', $set: { wrong: true } })
            product.registerDynamicEventProperties(() => ({ dynamic, plan: 'dynamic', tier: 'dynamic' }))
            const observed: Record<string, unknown>[] = []
            product.onEvent(({ properties }) => observed.push(properties))
            const pending = product[method](
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
            product.register({ stored: { count: 9 }, plan: 'later' })
            product.unregister('tier')
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

    it('stores the original analytics superProperties record in the Core-scoped namespace', async () => {
        const storage = new MemoryStorage()
        const { product } = await create(storage)
        product.register({ plan: 'pro', nested: { count: 1 } })
        const raw = requireInstalledExtension(
            storage.getItem(`ph_${options.projectToken}_posthog_browser_v2`) ?? undefined
        )
        expect(JSON.parse(raw)).toMatchObject({
            extensionData: { analytics: { superProperties: { plan: 'pro', nested: { count: 1 } } } },
        })
        const other = await create(storage, {}, 'ph_other_project')
        expect(other.product.getProperty('plan')).toBeUndefined()
        other.product.register({ plan: 'other' })
        const fresh = await create(storage)
        expect(fresh.product.getProperty('plan')).toBe('pro')
    })

    it('keeps local registration independent of consent and never-mode person processing', async () => {
        const { client, product, requests } = await create(false, { personProfiles: 'never' })
        client.optOut()
        product.registerOnce({ plan: 'pro', removed: true })
        product.unregister('removed')
        expect(product.getProperty('plan')).toBe('pro')
        product.capture('denied')
        expect(client.session).toBeUndefined()
        expect(requests).toHaveLength(0)
        client.optIn()
        product.capture('allowed')
        await client.flush()
        expect(events(requests)).toMatchObject([
            { event: 'allowed', properties: { plan: 'pro' }, options: { process_person_profile: false } },
        ])
    })

    it.each(['register', 'registerOnce'] as const)(
        '%s serializes caller values once and merges after reentrant local mutations',
        async (method) => {
            const { product } = await create()
            product.register({ retained: true, removed: true })
            const toJSON = vi.fn(() => {
                product.unregister('removed')
                product.register({ nestedOperation: true })
                return { caller: { count: 1 } }
            })
            product[method]({ toJSON })
            expect(toJSON).toHaveBeenCalledTimes(1)
            expect(product.getProperty('retained')).toBe(true)
            expect(product.getProperty('removed')).toBeUndefined()
            expect(product.getProperty('nestedOperation')).toBe(true)
            expect(product.getProperty('caller')).toEqual({ count: 1 })
        }
    )

    it.each(['register', 'registerOnce'] as const)(
        '%s does not evaluate inputs when state is unavailable and rechecks state after serialization',
        async (method) => {
            const { product } = await create()
            const prepare = vi.spyOn(BrowserState.prototype, 'prepare').mockReturnValue(false)
            const skipped = vi.fn(() => ({ skipped: true }))
            product[method]({ toJSON: skipped })
            expect(skipped).not.toHaveBeenCalled()
            expect(product.getProperty('skipped')).toBeUndefined()
            prepare.mockReturnValue(true)
            const toJSON = vi.fn(() => {
                prepare.mockReturnValue(false)
                return { late: true }
            })
            product[method]({ toJSON })
            expect(toJSON).toHaveBeenCalledTimes(1)
            prepare.mockRestore()
            expect(product.getProperty('late')).toBeUndefined()
        }
    )

    it('keeps detached and copied registration operations bound to their owner', async () => {
        const { client, product } = await create()
        const { register, registerOnce, unregister, getProperty } = product
        const copied = { register, registerOnce, unregister, getProperty }
        register({ plan: 'free', removed: true })
        copied.register({ plan: 'pro' })
        registerOnce({ plan: 'other', region: 'eu' })
        copied.unregister('removed')
        expect(getProperty('plan')).toBe('pro')
        expect(copied.getProperty('region')).toBe('eu')
        expect(getProperty('removed')).toBeUndefined()
        await client.dispose()
        copied.register({ late: true })
        copied.registerOnce({ late: true })
        copied.unregister('plan')
        expect(getProperty('late')).toBeUndefined()
    })

    it.each(['capture', 'captureImmediate'] as const)(
        '%s applies root caller serialization once to the merged context',
        async (method) => {
            const { client, product, requests } = await create()
            product.register({ persistent: true })
            product.registerDynamicEventProperties(() => ({ dynamic: true }))
            const toJSON = vi.fn(function (this: Record<string, unknown>) {
                return { persistent: this.persistent, dynamic: this.dynamic, caller: this.caller }
            })
            await product[method]('serialized', { caller: true, toJSON })
            await client.flush()
            expect(toJSON).toHaveBeenCalledTimes(1)
            expect(events(requests)).toMatchObject([
                { event: 'serialized', properties: { persistent: true, dynamic: true, caller: true } },
            ])
        }
    )

    it('clears future context on full reset without rewriting queued properties', async () => {
        const { client, product, requests } = await create()
        product.register({ context: { account: 'before' } })
        product.capture('before_reset')
        product.reset()
        expect(product.getProperty('context')).toBeUndefined()
        product.capture('after_reset')
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
            first.product.register({ retained: true })
            const pending: Promise<void>[] = []
            first.product[method]({
                toJSON() {
                    pending.push(first.client.dispose())
                    return { late: true }
                },
            })
            await Promise.all(pending)
            const fresh = await create(storage)
            expect(fresh.product.getProperty('retained')).toBe(true)
            expect(fresh.product.getProperty('late')).toBeUndefined()
        }
    )

    it.each(['capture', 'captureImmediate'] as const)(
        '%s retains its property snapshot when caller serialization changes registration',
        async (method) => {
            const { client, product, requests } = await create()
            product.register({ context: { count: 1 } })
            const toJSON = vi.fn(() => {
                product.register({ context: { count: 2 } })
                return { caller: true }
            })
            await product[method]('reentrant_snapshot', { converted: { toJSON } })
            await client.flush()
            expect(toJSON).toHaveBeenCalledTimes(1)
            expect(events(requests)).toMatchObject([
                { properties: { context: { count: 1 }, converted: { caller: true } } },
            ])
            expect(product.getProperty('context')).toEqual({ count: 2 })
        }
    )

    it('retains local properties when persistence fails and saves them on a later update', async () => {
        const storage = new MemoryStorage()
        const { product } = await create(storage)
        const write = vi.spyOn(storage, 'setItem').mockImplementation(() => {
            throw new Error('storage unavailable')
        })
        expect(() => product.register({ first: { count: 1 } })).not.toThrow()
        expect(product.getProperty('first')).toEqual({ count: 1 })
        write.mockRestore()
        product.register({ second: true })
        const fresh = await create(storage)
        expect(fresh.product.getProperty('first')).toEqual({ count: 1 })
        expect(fresh.product.getProperty('second')).toBe(true)
    })
})
