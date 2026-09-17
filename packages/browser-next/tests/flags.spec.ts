import { createPostHog, FeatureFlagsExtension } from '../src'
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
        expect(client.getExtension(FeatureFlagsExtension)!.getFeatureFlag('pending')).toBeUndefined()
        await vi.advanceTimersByTimeAsync(5)
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(String((fetch.mock.calls as unknown as Array<[unknown]>)[0]?.[0])).toContain('/flags/?v=2')
    })

    it('omits disabled flags and makes no flag requests', async () => {
        vi.useFakeTimers()
        const fetch = vi.fn()
        const client = await create({ flags: false, fetch })
        expect(client.getExtension('featureFlags')).toBeUndefined()
        await vi.advanceTimersByTimeAsync(10)
        expect(fetch).not.toHaveBeenCalled()
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
            expect(client.getExtension(FeatureFlagsExtension)!.getFeatureFlag('static')).toMatchObject({
                enabled: true,
                variant: 'variant',
            })
            expect(client.getExtension(FeatureFlagsExtension)!.getFeatureFlag('ignored')).toBeUndefined()
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
        const subscription = client.getExtension(FeatureFlagsExtension)!.onFeatureFlags(callback)
        expect(callback).toHaveBeenCalledWith(
            [
                expect.objectContaining({ key: 'off', enabled: false }),
                expect.objectContaining({ key: 'test', variant: 'a', payload: { text: 'payload' } }),
            ],
            false
        )
        expect(captured).not.toHaveBeenCalled()
        expect(client.getExtension(FeatureFlagsExtension)!.getFeatureFlag('off')).toMatchObject({ enabled: false })
        client.getExtension(FeatureFlagsExtension)!.updateFlags({ test: 'b' }, { test: 42 }, { merge: true })
        expect(client.getExtension(FeatureFlagsExtension)!.getFeatureFlag('test')).toMatchObject({
            variant: 'b',
            payload: 42,
        })
        expect(callback).toHaveBeenCalledTimes(2)
        subscription.dispose()
        client.getExtension(FeatureFlagsExtension)!.updateFlags({ after: true })
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
        expect(client.getExtension(FeatureFlagsExtension)!.getFeatureFlag('test')).toMatchObject({
            key: 'test',
            variant: 'blue',
            payload: { ok: true },
        })
    })

    it('snapshots extension configuration before setup', async () => {
        const options = { bootstrap: { featureFlags: { test: 'original' } }, featureFlagEvaluation: false }
        const extension = flags(options)
        options.bootstrap.featureFlags.test = 'changed'
        const client = await create({ extensions: [extension] })
        expect(client.getExtension(FeatureFlagsExtension)!.getFeatureFlag('test')?.variant).toBe('original')
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
        client.getExtension(FeatureFlagsExtension)!.updateFlags({ old: true })
        client.reset()
        expect(client.getExtension(FeatureFlagsExtension)!.getFeatureFlag('old')).toBeUndefined()
        await vi.advanceTimersByTimeAsync(5)
        expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('reports flag exposure again after changing identity', async () => {
        const client = await create({ flags: { featureFlagEvaluation: false } })
        const captured = vi.fn()
        client.onEvent(captured)
        client.getExtension(FeatureFlagsExtension)!.updateFlags({ test: true })
        client.getExtension(FeatureFlagsExtension)!.getFeatureFlag('test')
        await client.identify('next-person')
        client.getExtension(FeatureFlagsExtension)!.getFeatureFlag('test')
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

    it('uses bootstrap ahead of previously persisted evaluations', async () => {
        const storage = new MemoryStorage()
        const sibling = await create({ storage, flags: { featureFlagEvaluation: false } })
        sibling.getExtension(FeatureFlagsExtension)!.updateFlags({ test: 'old' })
        const bootstrapped = await create({
            storage,
            flags: { featureFlagEvaluation: false, bootstrap: { featureFlags: { test: 'new' } } },
        })
        expect(bootstrapped.getExtension(FeatureFlagsExtension)!.getFeatureFlag('test')?.variant).toBe('new')
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
    })

    it('disposal prevents pending requests and extension callbacks', async () => {
        vi.useFakeTimers()
        const fetch = vi.fn()
        const client = await create({ fetch })
        const extension = client.getExtension(FeatureFlagsExtension)!
        const callback = vi.fn()
        extension.onFeatureFlags(callback)
        await client.dispose()
        extension.updateFlags({ late: true })
        await vi.advanceTimersByTimeAsync(10)
        expect(fetch).not.toHaveBeenCalled()
        expect(callback).not.toHaveBeenCalled()
        expect(extension.getFeatureFlag('late')).toBeUndefined()
    })

    it('retains flags across core writes and reloads through client persistence', async () => {
        const storage = new MemoryStorage()
        const first = await create({ storage, flags: { featureFlagEvaluation: false } })
        first.getExtension(FeatureFlagsExtension)!.updateFlags({ saved: 'blue' }, { saved: { enabled: true } })
        first.kv.set('unrelated', 1)
        await first.group('organization', 'team')
        await first.dispose()

        const reloaded = await create({ storage, flags: { featureFlagEvaluation: false } })
        expect(reloaded.getExtension(FeatureFlagsExtension)!.getFeatureFlag('saved')).toMatchObject({
            variant: 'blue',
            payload: { enabled: true },
        })
        expect(reloaded.kv.get('unrelated')).toBe(1)
        reloaded.reset()
        expect(reloaded.getExtension(FeatureFlagsExtension)!.getFeatureFlag('saved')).toBeUndefined()
        await reloaded.dispose()

        const reset = await create({ storage, flags: { featureFlagEvaluation: false } })
        expect(reset.getExtension(FeatureFlagsExtension)!.getFeatureFlag('saved')).toBeUndefined()
    })

    it('honors custom persistence keys and storage:false', async () => {
        const storage = new MemoryStorage()
        const client = await create({ storage, persistenceKey: 'custom', flags: { featureFlagEvaluation: false } })
        client.getExtension(FeatureFlagsExtension)!.updateFlags({ durable: true })
        expect(storage.getItem('custom')).toContain('durable')
        const memory = await create({ flags: { featureFlagEvaluation: false } })
        memory.getExtension(FeatureFlagsExtension)!.updateFlags({ local: true })
        expect(memory.getExtension(FeatureFlagsExtension)!.getFeatureFlag('local')?.enabled).toBe(true)
        expect(storage.getItem('custom')).not.toContain('local')
    })
})
