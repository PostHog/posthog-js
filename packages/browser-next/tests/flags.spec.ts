import { createPostHog } from '../src'
import { createPostHog as createCore } from '../src/core'
import { flags } from '../src/flags'
import type { FlagsOptions } from '../src/flags'
import type { PostHog, PostHogOptions } from '../src/types'
import { localRemoteConfig, MemoryStorage } from './helpers'

const base = {
    remoteConfig: localRemoteConfig,
    projectToken: 'ph_flags_test',
    capturePageview: false,
    storage: false,
    navigator: false,
    analytics: false,
} as const
const clients: PostHog[] = []
const create = async (options: Partial<PostHogOptions> = {}) => {
    const client = await createPostHog({ ...base, fetch: false, ...options })
    clients.push(client)
    return client
}

afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.dispose()))
    vi.useRealTimers()
})

describe('flags', () => {
    it('dynamically installs flags by default and begins evaluation without waiting for its response', async () => {
        vi.useFakeTimers()
        const fetch = vi.fn(() => new Promise<Response>(() => {}))
        const client = await create({ fetch })
        expect(client.getExtension('featureFlags')).toBeDefined()
        expect(client.getFeatureFlag('pending')).toBeUndefined()
        await vi.advanceTimersByTimeAsync(5)
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(String((fetch.mock.calls as unknown as Array<[unknown]>)[0]?.[0])).toContain('/flags/?v=2')
    })

    it('leaves disabled clients with safe root operations and no flag requests', async () => {
        vi.useFakeTimers()
        const fetch = vi.fn()
        const client = await create({ flags: false, fetch })
        expect(client.getExtension('featureFlags')).toBeUndefined()
        const callback = vi.fn()
        const subscription = client.onFeatureFlags(callback)
        client.updateFlags({ local: true })
        expect(client.getFeatureFlag('local')).toBeUndefined()
        subscription.dispose()
        await vi.advanceTimersByTimeAsync(10)
        expect(fetch).not.toHaveBeenCalled()
        expect(callback).not.toHaveBeenCalled()
    })

    it('keeps the manual core entrypoint free of automatic flags', async () => {
        const client = await createCore({ ...base, fetch: false })
        clients.push(client)
        expect(client.getExtension('featureFlags')).toBeUndefined()
    })

    it.each([false, { bootstrap: { featureFlags: { ignored: true } } }] as const)(
        'prefers the explicit static instance over %j',
        async (configuration) => {
            const extension = flags({
                featureFlagEvaluation: false,
                bootstrap: { featureFlags: { static: 'variant' } },
            })
            const client = await create({ flags: configuration, extensions: [extension] })
            expect(client.getExtension('featureFlags')).toBe(extension)
            expect(client.getFeatureFlag('static')).toMatchObject({ enabled: true, variant: 'variant' })
            expect(client.getFeatureFlag('ignored')).toBeUndefined()
        }
    )

    it.each(['static', 'dynamic'])('uses the same %s configuration and result/subscription API', async (mode) => {
        vi.useFakeTimers()
        const options: FlagsOptions = {
            featureFlagEvaluation: false,
            bootstrap: { featureFlags: { off: false, test: 'a' }, featureFlagPayloads: { test: { text: 'payload' } } },
        }
        const fetch = vi.fn()
        const client = await create(
            mode === 'static' ? { fetch, extensions: [flags(options)] } : { fetch, flags: options }
        )
        const captured = vi.fn()
        client.onEvent(captured)
        const callback = vi.fn()
        const subscription = client.onFeatureFlags(callback)
        expect(callback).toHaveBeenCalledWith(
            [
                expect.objectContaining({ key: 'off', enabled: false }),
                expect.objectContaining({ key: 'test', variant: 'a', payload: { text: 'payload' } }),
            ],
            false
        )
        expect(captured).not.toHaveBeenCalled()
        expect(client.getFeatureFlag('off')).toMatchObject({ enabled: false })
        client.updateFlags({ test: 'b' }, { test: 42 }, { merge: true })
        expect(client.getFeatureFlag('test')).toMatchObject({ variant: 'b', payload: 42 })
        expect(callback).toHaveBeenCalledTimes(2)
        subscription.dispose()
        client.updateFlags({ after: true })
        expect(callback).toHaveBeenCalledTimes(2)
        await vi.advanceTimersByTimeAsync(20)
        expect(fetch).not.toHaveBeenCalled()
    })

    it('maps camelCase configuration to stable request fields and produces result metadata', async () => {
        vi.useFakeTimers()
        const fetch = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        flags: {
                            test: {
                                key: 'test',
                                enabled: true,
                                variant: 'blue',
                                metadata: { id: 7, payload: '{"ok":true}' },
                            },
                        },
                    })
                )
        )
        const client = await create({
            fetch,
            flags: { evaluationContexts: ['web'], flagKeys: ['test'], refreshIntervalMs: 0, requestTimeoutMs: 100 },
        })
        await vi.advanceTimersByTimeAsync(5)
        const init = (fetch.mock.calls as unknown as Array<[unknown, RequestInit]>)[0]?.[1]
        expect(JSON.parse(String(init?.body))).toMatchObject({
            evaluation_contexts: ['web'],
            flag_keys: ['test'],
            distinct_id: client.distinctId,
        })
        expect(client.getFeatureFlag('test')).toMatchObject({ key: 'test', variant: 'blue', payload: { ok: true } })
    })

    it('snapshots extension configuration before setup', async () => {
        const options = { bootstrap: { featureFlags: { test: 'original' } }, featureFlagEvaluation: false }
        const extension = flags(options)
        options.bootstrap.featureFlags.test = 'changed'
        const client = await create({ extensions: [extension] })
        expect(client.getFeatureFlag('test')?.variant).toBe('original')
    })

    it('tracks identity, group and reset independently of capture consent', async () => {
        vi.useFakeTimers()
        const fetch = vi.fn(async () => new Response('{}'))
        const client = await create({ fetch, optOutByDefault: true })
        await client.identify('person', { plan: 'pro' })
        await client.group('organization', 'team', { size: 5 })
        client.optIn()
        await vi.advanceTimersByTimeAsync(5)
        const init = (fetch.mock.calls as unknown as Array<[unknown, RequestInit]>)[0]?.[1]
        expect(JSON.parse(String(init?.body))).toMatchObject({
            distinct_id: 'person',
            groups: { organization: 'team' },
            person_properties: { plan: 'pro' },
            group_properties: { organization: { size: 5 } },
        })
        client.updateFlags({ old: true })
        client.reset()
        expect(client.getFeatureFlag('old')).toBeUndefined()
        await vi.advanceTimersByTimeAsync(5)
        expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('reports flag exposure again after changing identity', async () => {
        const client = await create({ flags: { featureFlagEvaluation: false } })
        const captured = vi.fn()
        client.onEvent(captured)
        client.updateFlags({ test: true })
        client.getFeatureFlag('test')
        await client.identify('next-person')
        client.getFeatureFlag('test')
        expect(captured.mock.calls.filter(([event]) => event.event === '$feature_flag_called')).toHaveLength(2)
    })

    it('clears evaluation properties when the group key changes', async () => {
        vi.useFakeTimers()
        const fetch = vi.fn(async () => new Response('{}'))
        const client = await create({ fetch })
        await client.group('org', 'A', { plan: 'paid' })
        await client.group('org', 'B')
        await vi.advanceTimersByTimeAsync(5)
        const init = (fetch.mock.calls as unknown as Array<[unknown, RequestInit]>)[0]?.[1]
        expect(JSON.parse(String(init?.body)).groups).toEqual({ org: 'B' })
        expect(JSON.parse(String(init?.body)).group_properties.org).toEqual({})
    })

    it('does not hand off an identified user as an anonymous identity', async () => {
        vi.useFakeTimers()
        const fetch = vi.fn(async () => new Response('{}'))
        const client = await create({ fetch })
        const anonymousId = client.distinctId
        await client.identify('A')
        await vi.advanceTimersByTimeAsync(5)
        const first = (fetch.mock.calls as unknown as Array<[unknown, RequestInit]>)[0]?.[1]
        expect(JSON.parse(String(first?.body)).$anon_distinct_id).toBe(anonymousId)
        await client.identify('B')
        await vi.advanceTimersByTimeAsync(5)
        const last = (fetch.mock.calls as unknown as Array<[unknown, RequestInit]>).at(-1)?.[1]
        expect(JSON.parse(String(last?.body))).toMatchObject({ distinct_id: 'B' })
        expect(JSON.parse(String(last?.body)).$anon_distinct_id).not.toBe('A')
    })

    it('retains bootstrap when a sibling only records an exposure', async () => {
        const storage = new MemoryStorage()
        const sibling = await create({ storage, flags: { featureFlagEvaluation: false } })
        sibling.updateFlags({ test: 'old' })
        const bootstrapped = await create({
            storage,
            flags: { featureFlagEvaluation: false, bootstrap: { featureFlags: { test: 'new' } } },
        })
        sibling.getFeatureFlag('test')
        bootstrapped.getFeatureFlag('test')
        expect(bootstrapped.getFeatureFlag('test')?.variant).toBe('new')
    })

    it('contains failing flags delegates and setup while keeping core capture usable', async () => {
        const client = await create({
            extensions: [
                {
                    name: 'featureFlags',
                    setup() {
                        throw new Error('setup')
                    },
                },
            ],
        })
        expect(client.getExtension('featureFlags')).toBeUndefined()
        client.capture('still works')
        expect(client.getFeatureFlag('test')).toBeUndefined()
    })

    it('disposal prevents pending requests and root callbacks', async () => {
        vi.useFakeTimers()
        const fetch = vi.fn()
        const client = await create({ fetch })
        const callback = vi.fn()
        client.onFeatureFlags(callback)
        await client.dispose()
        client.updateFlags({ late: true })
        await vi.advanceTimersByTimeAsync(10)
        expect(fetch).not.toHaveBeenCalled()
        expect(callback).not.toHaveBeenCalled()
        expect(client.getFeatureFlag('late')).toBeUndefined()
    })

    it('persists flags separately from core writes and rejects foreign identities', async () => {
        const storage = new MemoryStorage()
        const first = await create({ storage, flags: { featureFlagEvaluation: false } })
        const second = await create({ storage, flags: { featureFlagEvaluation: false } })
        first.updateFlags({ shared: true })
        second.kv.set('unrelated', 1)
        expect(second.getFeatureFlag('shared')?.enabled).toBe(true)
        await first.identify('different')
        first.updateFlags({ foreign: true })
        expect(second.getFeatureFlag('foreign')).toBeUndefined()
        second.updateFlags({ stale: true })
        expect(first.getFeatureFlag('foreign')?.enabled).toBe(true)
        expect(first.getFeatureFlag('stale')).toBeUndefined()
        first.reset()
        expect(first.getFeatureFlag('foreign')).toBeUndefined()
    })

    it('honors custom persistence keys and storage:false', async () => {
        const storage = new MemoryStorage()
        const client = await create({ storage, persistenceKey: 'custom', flags: { featureFlagEvaluation: false } })
        client.updateFlags({ durable: true })
        expect(storage.getItem('custom_flags')).toContain('durable')
        const memory = await create({ flags: { featureFlagEvaluation: false } })
        memory.updateFlags({ local: true })
        expect(memory.getFeatureFlag('local')?.enabled).toBe(true)
        expect(storage.getItem('custom_flags')).not.toContain('local')
    })
})
