import { analytics, type AnalyticsOptions } from '../src/analytics'
import { createPostHog } from '../src/core'
import { BrowserState } from '../src/state'
import { EventBuffer } from '../src/event-buffer'
import { createFetch, localRemoteConfig, MemoryStorage, requireInstalledExtension, type SentRequest } from './helpers'

const options = {
    projectToken: 'ph_identity_helpers',
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

describe('analytics alias', () => {
    it('keeps helpers safe before installation', async () => {
        const product = analytics()
        expect(() => {
            product.alias('account')
            product.groupIdentify('organization', 0)
            product.resetGroups()
        }).not.toThrow()
        await product.dispose?.()
    })

    it('links the current ID without changing identity or publishing identity notifications', async () => {
        const { client, product, requests } = await create()
        const original = { distinctId: client.distinctId, anonymousId: client.anonymousId, deviceId: client.deviceId }
        const identified = vi.fn()
        const grouped = vi.fn()
        const groups = client.groups
        client.onIdentify(identified)
        client.onGroup(grouped)
        const observed = vi.fn()
        product.onEvent(observed)
        product.alias('account-123')
        expect(observed).toHaveBeenCalledWith(
            expect.objectContaining({
                event: '$create_alias',
                properties: expect.objectContaining({ alias: 'account-123', distinct_id: original.distinctId }),
            })
        )
        expect({ distinctId: client.distinctId, anonymousId: client.anonymousId, deviceId: client.deviceId }).toEqual(
            original
        )
        expect(identified).not.toHaveBeenCalled()
        expect(grouped).not.toHaveBeenCalled()
        expect(client.groups).toEqual(groups)
        product.capture('after_alias')
        await product.identify('account-123')
        await client.flush()
        expect(events(requests)).toMatchObject([
            {
                event: '$create_alias',
                distinct_id: original.distinctId,
                properties: { alias: 'account-123' },
                options: { process_person_profile: true },
            },
            { event: 'after_alias', distinct_id: original.distinctId, options: { process_person_profile: true } },
            { event: '$identify', distinct_id: 'account-123', properties: { $anon_distinct_id: original.distinctId } },
        ])
        expect(events(requests)).toHaveLength(3)
    })

    it('retains alias-enabled person processing across reload and clears it on reset', async () => {
        const storage = new MemoryStorage()
        const first = await create({}, storage)
        first.product.alias('account-123')
        await first.client.flush()
        await first.client.dispose()
        const second = await create({}, storage)
        second.product.capture('after_reload')
        second.product.reset()
        second.product.capture('after_reset')
        await second.client.flush()
        expect(events(second.requests).map(({ event, options }) => [event, options.process_person_profile])).toEqual([
            ['after_reload', true],
            ['after_reset', false],
        ])
    })

    it.each(['denied', 'never'] as const)('does not enable processing or enqueue an alias when %s', async (mode) => {
        const storage = new MemoryStorage()
        const first = await create(mode === 'never' ? { personProfiles: 'never' } : {}, storage)
        const distinctId = first.client.distinctId
        if (mode === 'denied') first.client.optOut()
        first.product.alias('account-123')
        if (mode === 'denied') first.client.optIn()
        await first.client.dispose()
        expect(events(first.requests)).toHaveLength(0)
        const second = await create({}, storage)
        second.product.capture('ordinary')
        await second.client.flush()
        expect(events(second.requests)).toMatchObject([
            { event: 'ordinary', distinct_id: distinctId, options: { process_person_profile: false } },
        ])
        expect(events(second.requests)).toHaveLength(1)
    })

    it('rejects invalid alias targets without enabling person processing', async () => {
        const { client, product, requests } = await create()
        const invalid: unknown[] = ['', ' ', null, undefined, 0, {}]
        for (const target of invalid) {
            expect(() => {
                // @ts-expect-error Exercise JavaScript callers with malformed target IDs.
                product.alias(target)
            }).not.toThrow()
        }
        product.capture('ordinary')
        await client.flush()
        expect(events(requests)).toMatchObject([{ event: 'ordinary', options: { process_person_profile: false } }])
        expect(events(requests)).toHaveLength(1)
    })

    it('uses ordinary capture rate limiting and makes retained handles inert after disposal', async () => {
        const { client, product, requests } = await create()
        for (let index = 0; index < 100; index++) product.capture('ordinary')
        product.alias('limited')
        await client.flush()
        expect(events(requests).filter(({ event }) => event === '$create_alias')).toHaveLength(0)
        expect(events(requests).filter(({ event }) => event === '$$client_ingestion_warning')).toHaveLength(1)
        await client.dispose()
        const delivered = events(requests).length
        expect(() => product.alias('disposed')).not.toThrow()
        expect(events(requests)).toHaveLength(delivered)
    })
})

describe('analytics group helpers', () => {
    it('updates a group profile with capture options without changing ambient membership', async () => {
        const { client, product, requests } = await create()
        await product.group('organization', 'current')
        const grouped = vi.fn()
        client.onGroup(grouped)
        const uuid = '12345678-1234-4234-8234-123456789abc'
        const timestamp = new Date('2026-01-02T03:04:05Z')
        const properties = { plan: 'paid', nested: { size: 5 } }
        const set = { role: 'admin' }
        product.groupIdentify('organization', 0, properties, { uuid, timestamp, set })
        properties.nested.size = 9
        set.role = 'changed'
        expect(client.groups).toEqual({ organization: 'current' })
        expect(grouped).not.toHaveBeenCalled()
        await client.flush()
        expect(events(requests).at(-1)).toMatchObject({
            event: '$groupidentify',
            uuid,
            timestamp: timestamp.toISOString(),
            distinct_id: client.distinctId,
            properties: {
                $group_type: 'organization',
                $group_key: 0,
                $group_set: { plan: 'paid', nested: { size: 5 } },
                $set: { role: 'admin' },
            },
            options: { process_person_profile: true },
        })
    })

    it('processes an anonymous group profile without identifying the user or joining that group', async () => {
        const { client, product, requests } = await create()
        const distinctId = client.distinctId
        product.groupIdentify('organization', 'external')
        product.capture('after_group_profile')
        expect(client.distinctId).toBe(distinctId)
        expect(client.groups).toEqual({})
        await client.flush()
        expect(events(requests)).toMatchObject([
            {
                event: '$groupidentify',
                properties: { $group_type: 'organization', $group_key: 'external', $group_set: {} },
                options: { process_person_profile: true },
            },
            { event: 'after_group_profile', distinct_id: distinctId, options: { process_person_profile: true } },
        ])
        expect(events(requests)).toHaveLength(2)
    })

    it('warns for invalid group identities and contains malformed properties', async () => {
        const { client, product, requests } = await create()
        const warn = vi.spyOn(client.logger, 'warn')
        const invalid: unknown[] = ['', ' ', undefined, null, NaN, Infinity, {}]
        for (const key of invalid) {
            expect(() => {
                // @ts-expect-error Exercise malformed group keys from JavaScript.
                product.groupIdentify('organization', key)
            }).not.toThrow()
        }
        product.groupIdentify('', 'external')
        expect(warn).toHaveBeenCalledTimes(invalid.length + 1)
        expect(warn).toHaveBeenCalledWith('Group identify requires a non-empty type and a string or finite numeric key')
        product.capture('ordinary')
        const cycle: Record<string, unknown> = {}
        cycle.self = cycle
        expect(() => product.groupIdentify('organization', 'external', cycle)).not.toThrow()
        await client.flush()
        expect(events(requests)).toMatchObject([{ event: 'ordinary', options: { process_person_profile: false } }])
        expect(events(requests)).toHaveLength(1)
    })

    it('clears only memberships while retaining identity, session and other persisted values', async () => {
        const storage = new MemoryStorage()
        const { client, product, requests } = await create({}, storage)
        await product.identify('member')
        await product.group('organization', 'acme')
        await product.group('project', 'web')
        client.kv.set('retained', true)
        product.capture('before_group_reset')
        const before = {
            distinctId: client.distinctId,
            anonymousId: client.anonymousId,
            deviceId: client.deviceId,
            session: client.session,
        }
        const reset = vi.fn()
        client.onReset(reset)
        product.resetGroups()
        expect(client.groups).toEqual({})
        expect({
            distinctId: client.distinctId,
            anonymousId: client.anonymousId,
            deviceId: client.deviceId,
            session: client.session,
        }).toEqual(before)
        expect(client.kv.get('retained')).toBe(true)
        expect(reset).not.toHaveBeenCalled()
        product.capture('after_group_reset')
        await client.flush()
        expect(events(requests).find(({ event }) => event === 'before_group_reset')).toMatchObject({
            distinct_id: 'member',
            properties: { $groups: { organization: 'acme', project: 'web' } },
        })
        expect(events(requests).at(-1)).toMatchObject({
            event: 'after_group_reset',
            properties: { $groups: {} },
            options: { process_person_profile: true },
        })
        await client.dispose()
        const reloaded = await create({}, storage)
        expect(reloaded.client.groups).toEqual({})
        expect(reloaded.client.distinctId).toBe('member')
        expect(reloaded.client.kv.get('retained')).toBe(true)
    })

    it.each(['denied', 'never'] as const)(
        'permits group cleanup but suppresses profile updates when %s',
        async (mode) => {
            const storage = new MemoryStorage()
            const original = await create({}, storage)
            await original.product.group('organization', 'old')
            await original.client.dispose()
            const current = await create(mode === 'never' ? { personProfiles: 'never' } : {}, storage)
            if (mode === 'denied') current.client.optOut()
            current.product.groupIdentify('organization', 'external')
            current.product.resetGroups()
            expect(current.client.groups).toEqual({})
            if (mode === 'denied') current.client.optIn()
            current.product.capture('ordinary')
            await current.client.flush()
            expect(events(current.requests)).toMatchObject([{ event: 'ordinary', properties: { $groups: {} } }])
            expect(events(current.requests)).toHaveLength(1)
        }
    )

    it('does not create a session for empty group cleanup and makes disposed controls inert', async () => {
        const { client, product, requests } = await create()
        product.resetGroups()
        expect(client.session).toBeUndefined()
        await product.group('organization', 'retained')
        await client.dispose()
        const groups = client.groups
        const count = events(requests).length
        product.resetGroups()
        product.groupIdentify('organization', 'late')
        expect(client.groups).toEqual(groups)
        expect(events(requests)).toHaveLength(count)
    })
})

describe('identity helper admission and group reset isolation', () => {
    it.each(['alias', 'groupIdentify'] as const)(
        'retains explicit processing enablement from %s after group-only reset',
        async (method) => {
            const { client, product, requests } = await create()
            if (method === 'alias') product.alias('account')
            else product.groupIdentify('organization', 42)
            product.resetGroups()
            product.capture('after_cleanup')
            await client.flush()
            expect(events(requests).at(-1)).toMatchObject({
                event: 'after_cleanup',
                options: { process_person_profile: true },
                properties: { $groups: {} },
            })
        }
    )

    it('retains person-property deduplication on group-only reset', async () => {
        const { client, product, requests } = await create()
        product.setPersonProperties({ plan: 'paid' })
        await product.group('organization', 'acme')
        product.resetGroups()
        product.setPersonProperties({ plan: 'paid' })
        await client.flush()
        expect(events(requests).filter(({ event }) => event === '$set')).toHaveLength(1)
    })

    it.each(['alias', 'groupIdentify'] as const)(
        '%s retains explicit enablement but publishes no event when session admission fails',
        async (method) => {
            const { client, product, requests } = await create()
            const observed = vi.fn()
            product.onEvent(observed)
            const reject = vi.spyOn(BrowserState.prototype, 'sessionAdmitted').mockReturnValue(false)
            try {
                if (method === 'alias') product.alias('account')
                else product.groupIdentify('organization', 'external')
                expect(observed).not.toHaveBeenCalled()
                expect(client.session).toBeUndefined()
            } finally {
                reject.mockRestore()
            }
            product.capture('ordinary')
            await client.flush()
            expect(events(requests)).toMatchObject([{ event: 'ordinary', options: { process_person_profile: true } }])
            expect(events(requests)).toHaveLength(1)
        }
    )

    it('uses bounded admission for group profile updates', async () => {
        const { client, product, requests } = await create()
        const observed = vi.fn()
        product.onEvent(observed)
        const reject = vi.spyOn(EventBuffer.prototype, 'enqueue').mockReturnValue(false)
        try {
            product.groupIdentify('organization', 42, { plan: 'paid' })
            expect(observed).not.toHaveBeenCalled()
            expect(client.session).toBeUndefined()
            expect(client.groups).toEqual({})
        } finally {
            reject.mockRestore()
        }
        await client.flush()
        expect(events(requests)).toEqual([])
    })

    it('does not evaluate group properties or options while capture is denied', async () => {
        const { client, product, requests } = await create()
        client.optOut()
        const serialize = vi.fn(() => ({ plan: 'paid' }))
        const readUuid = vi.fn(() => 'ignored')
        product.groupIdentify(
            'organization',
            'external',
            { toJSON: serialize },
            {
                get uuid() {
                    return readUuid()
                },
            }
        )
        expect(serialize).not.toHaveBeenCalled()
        expect(readUuid).not.toHaveBeenCalled()
        client.optIn()
        product.capture('ordinary')
        await client.flush()
        expect(events(requests)).toMatchObject([{ event: 'ordinary', options: { process_person_profile: false } }])
    })
})
