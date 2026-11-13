import { PostHogFeatureFlags } from '@posthog/browser-common/feature-flags'
import type {
    FeatureFlagsOptions,
    FeatureFlagsReadOptions,
    FeatureFlagsReloadResult,
} from '../src/products/flags/flags-options'
import { featureFlags } from '../src/products/flags/flags'
import type { IPostHog, PostHogOptions } from '../src/core/types'
import { createBufferedRootPostHog, localRemoteConfig, MemoryStorage, requireInstalledExtension } from './helpers'

const clients: IPostHog[] = []
const create = async (options: Partial<PostHogOptions> = {}) => {
    const client = await createBufferedRootPostHog({
        projectToken: 'ph_flags_read_controls',
        remoteConfig: localRemoteConfig,
        capturePageview: false,
        storage: false,
        navigator: false,
        fetch: false,
        analytics: false,
        ...options,
    })
    clients.push(client)
    return client
}
const remoteFlags = () =>
    new Response(
        JSON.stringify({
            flags: {
                test: { key: 'test', enabled: true, variant: 'remote', metadata: { payload: '{"source":"remote"}' } },
                off: { key: 'off', enabled: false },
            },
        })
    )

afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.dispose()))
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
})

describe.each(['static', 'automatic'] as const)('%s flags read controls', (mode) => {
    const createFlags = (options: FeatureFlagsOptions, overrides: Partial<PostHogOptions> = {}) =>
        create({ ...(mode === 'static' ? { extensions: [featureFlags(options)] } : { flags: options }), ...overrides })

    it.each([
        ['omitted options', undefined],
        ['empty options', {}],
        ['undefined event option', { sendFeatureFlagEvent: undefined } as unknown as FeatureFlagsReadOptions],
        ['explicit event option', { sendFeatureFlagEvent: true }],
        ['default freshness', { fresh: false }],
    ] as const)('suppresses one read without suppressing later ordinary reads: %s', async (_label, options) => {
        const client = await createFlags({ featureFlagEvaluation: false })
        const flags = requireInstalledExtension(client.featureFlags)
        const captured = vi.fn()
        requireInstalledExtension(client.analytics).onEvent(captured)
        flags.updateFlags({ test: 'blue' }, { test: { source: 'local' } })
        const expected = { key: 'test', enabled: true, variant: 'blue', payload: { source: 'local' } }
        expect(flags.getFeatureFlag('test', { sendFeatureFlagEvent: false })).toEqual(expected)
        expect(flags.getFeatureFlag('test', { sendFeatureFlagEvent: false })).toEqual(expected)
        expect(captured).not.toHaveBeenCalled()
        expect(flags.getFeatureFlag('test', options)).toEqual(expected)
        expect(flags.getFeatureFlag('test', options)).toEqual(expected)
        expect(captured).toHaveBeenCalledOnce()
        expect(captured.mock.calls[0]?.[0]).toMatchObject({
            event: '$feature_flag_called',
            properties: { $feature_flag: 'test', $feature_flag_response: 'blue' },
        })
    })

    it('does not retain a suppressed read for capture after opt-in', async () => {
        const client = await createFlags({ featureFlagEvaluation: false }, { optOutByDefault: true })
        const flags = requireInstalledExtension(client.featureFlags)
        const product = requireInstalledExtension(client.analytics)
        const captured = vi.fn()
        product.onEvent(captured)
        flags.updateFlags({ test: true })
        expect(flags.getFeatureFlag('test', { sendFeatureFlagEvent: false })?.enabled).toBe(true)
        client.optIn()
        product.capture('after-opt-in')
        expect(captured.mock.calls.map(([event]) => event.event)).toEqual(['after-opt-in'])
        flags.getFeatureFlag('test')
        expect(captured.mock.calls.map(([event]) => event.event)).toEqual(['after-opt-in', '$feature_flag_called'])
    })

    it.each(['bootstrap', 'persisted'] as const)(
        'keeps fresh reads synchronous and remote-only before loading over %s values',
        async (source) => {
            vi.useFakeTimers()
            const storage = new MemoryStorage()
            if (source === 'persisted') {
                const previous = await createFlags({ featureFlagEvaluation: false }, { storage })
                requireInstalledExtension(previous.featureFlags).updateFlags({ test: 'persisted', off: false })
                await previous.dispose()
            }
            const fetch = vi.fn(async () => remoteFlags())
            const client = await createFlags(
                {
                    refreshIntervalMs: 0,
                    ...(source === 'bootstrap'
                        ? { bootstrap: { featureFlags: { test: 'bootstrap', off: false } } }
                        : {}),
                },
                { storage, fetch }
            )
            const flags = requireInstalledExtension(client.featureFlags)
            const captured = vi.fn()
            requireInstalledExtension(client.analytics).onEvent(captured)
            expect(flags.getFeatureFlag('test', { sendFeatureFlagEvent: false })?.variant).toBe(source)
            expect(flags.getFeatureFlag('off', { sendFeatureFlagEvent: false })).toEqual({
                key: 'off',
                enabled: false,
                variant: undefined,
                payload: undefined,
            })
            expect(flags.getFeatureFlag('test', { fresh: true })).toBeUndefined()
            expect(flags.getFeatureFlag('off', { fresh: true })).toBeUndefined()
            expect(captured).not.toHaveBeenCalled()
            expect(fetch).not.toHaveBeenCalled()
            const reload = flags.reloadFeatureFlags()
            await vi.advanceTimersByTimeAsync(5)
            expect(await reload).toEqual({ status: 'loaded' })
            expect(fetch).toHaveBeenCalledOnce()
            expect(flags.getFeatureFlag('test', { fresh: true, sendFeatureFlagEvent: false })).toEqual({
                key: 'test',
                enabled: true,
                variant: 'remote',
                payload: { source: 'remote' },
            })
            expect(flags.getFeatureFlag('off', { fresh: true, sendFeatureFlagEvent: false })).toEqual({
                key: 'off',
                enabled: false,
                variant: undefined,
                payload: undefined,
            })
            expect(flags.getFeatureFlag('unknown', { fresh: true, sendFeatureFlagEvent: false })).toBeUndefined()
            expect(captured).not.toHaveBeenCalled()
            expect(fetch).toHaveBeenCalledOnce()
            flags.getFeatureFlag('off', { fresh: true })
            expect(captured).toHaveBeenCalledOnce()
            expect(captured.mock.calls[0]?.[0]).toMatchObject({
                event: '$feature_flag_called',
                properties: { $feature_flag_response: false },
            })
        }
    )

    it('does not treat injected values as a completed remote evaluation', async () => {
        const client = await createFlags({ featureFlagEvaluation: false })
        const flags = requireInstalledExtension(client.featureFlags)
        flags.updateFlags({ test: true })
        expect(flags.getFeatureFlag('test', { fresh: true })).toBeUndefined()
        expect(flags.getFeatureFlag('test', { sendFeatureFlagEvent: false })?.enabled).toBe(true)
    })

    it.each(['bootstrap', 'injected'] as const)(
        'isolates nested %s payloads returned by synchronous snapshots',
        async (source) => {
            const values = { test: true, array: 'blue', nil: true, absent: true, off: false }
            const payloads = {
                test: { nested: { text: 'original' } },
                array: [{ text: 'original' }, null],
                nil: null,
            }
            const fetch = vi.fn()
            const client = await createFlags(
                {
                    featureFlagEvaluation: false,
                    ...(source === 'bootstrap'
                        ? { bootstrap: { featureFlags: values, featureFlagPayloads: payloads } }
                        : {}),
                },
                { fetch }
            )
            const flags = requireInstalledExtension(client.featureFlags)
            const captured = vi.fn()
            requireInstalledExtension(client.analytics).onEvent(captured)
            if (source === 'injected') flags.updateFlags(values, payloads)
            const snapshot = flags.getAllFeatureFlags()
            expect(snapshot).toEqual([
                { key: 'test', enabled: true, variant: undefined, payload: { nested: { text: 'original' } } },
                { key: 'array', enabled: true, variant: 'blue', payload: [{ text: 'original' }, null] },
                { key: 'nil', enabled: true, variant: undefined, payload: null },
                { key: 'absent', enabled: true, variant: undefined, payload: undefined },
                { key: 'off', enabled: false, variant: undefined, payload: undefined },
            ])
            expect(Object.keys(snapshot[3]!)).toEqual(['key', 'enabled', 'variant', 'payload'])
            expect(captured).not.toHaveBeenCalled()
            const payload = snapshot[0]?.payload as { nested: { text: string } }
            payload.nested.text = 'mutated'
            const array = snapshot[1]?.payload as Array<{ text: string } | null>
            array[0]!.text = 'mutated'
            array.push({ text: 'added' })
            Object.assign(snapshot[0]!, { key: 'changed', enabled: false })
            snapshot.pop()
            expect(flags.getAllFeatureFlags()).toEqual([
                { key: 'test', enabled: true, variant: undefined, payload: { nested: { text: 'original' } } },
                { key: 'array', enabled: true, variant: 'blue', payload: [{ text: 'original' }, null] },
                { key: 'nil', enabled: true, variant: undefined, payload: null },
                { key: 'absent', enabled: true, variant: undefined, payload: undefined },
                { key: 'off', enabled: false, variant: undefined, payload: undefined },
            ])
            expect(flags.getFeatureFlag('test', { sendFeatureFlagEvent: false })?.payload).toEqual({
                nested: { text: 'original' },
            })
            expect(captured).not.toHaveBeenCalled()
            flags.getFeatureFlag('test')
            expect(captured).toHaveBeenCalledOnce()
            flags.updateFlags({ later: true })
            expect(snapshot[0]?.payload).toEqual({ nested: { text: 'mutated' } })
            expect(fetch).not.toHaveBeenCalled()
            flags.getFeatureFlag('later')
            expect(captured).toHaveBeenCalledTimes(2)
        }
    )

    it('keeps empty variants disabled in exposure-free snapshots', async () => {
        const client = await createFlags({ featureFlagEvaluation: false })
        const flags = requireInstalledExtension(client.featureFlags)
        const captured = vi.fn()
        requireInstalledExtension(client.analytics).onEvent(captured)
        flags.updateFlags({ legacy: '' }, { legacy: { copy: ['original'] } })
        const expected = {
            key: 'legacy',
            enabled: false,
            variant: '',
            payload: { copy: ['original'] },
        }
        expect(flags.getFeatureFlag('legacy', { sendFeatureFlagEvent: false })).toEqual(expected)
        const snapshot = flags.getAllFeatureFlags()
        expect(snapshot).toEqual([expected])
        const payload = snapshot[0]?.payload as { copy: string[] }
        payload.copy.push('changed')
        expect(flags.getAllFeatureFlags()).toEqual([expected])
        expect(captured).not.toHaveBeenCalled()
    })

    it('returns an exposure-free empty snapshot while values are unavailable', async () => {
        vi.useFakeTimers()
        const fetch = vi.fn(() => new Promise<Response>(() => {}))
        const client = await createFlags({}, { fetch })
        const flags = requireInstalledExtension(client.featureFlags)
        expect(flags.getAllFeatureFlags()).toEqual([])
        expect(fetch).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(5)
        expect(flags.getAllFeatureFlags()).toEqual([])
        expect(fetch).toHaveBeenCalledOnce()
    })

    it('observes explicit, identity-triggered and interval reload starts without replaying earlier starts', async () => {
        vi.useFakeTimers()
        const fetch = vi.fn(async () => remoteFlags())
        vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
        const client = await createFlags({ refreshIntervalMs: 50 }, { fetch })
        const flags = requireInstalledExtension(client.featureFlags)
        const callback = vi.fn()
        const subscription = flags.onReloading(callback)
        expect(callback).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(5)
        const reload = flags.reloadFeatureFlags()
        const sharedReload = flags.reloadFeatureFlags()
        expect(callback).toHaveBeenCalledOnce()
        expect(fetch).toHaveBeenCalledOnce()
        await vi.advanceTimersByTimeAsync(5)
        expect(await reload).toEqual({ status: 'loaded' })
        expect(await sharedReload).toEqual({ status: 'loaded' })
        await requireInstalledExtension(client.analytics).identify('next-person')
        expect(callback).toHaveBeenCalledTimes(2)
        await vi.advanceTimersByTimeAsync(40)
        expect(callback).toHaveBeenCalledTimes(3)
        await vi.advanceTimersByTimeAsync(5)
        const retained = vi.fn()
        flags.onReloading(retained)
        subscription.dispose()
        subscription.dispose()
        const afterUnsubscribe = flags.reloadFeatureFlags()
        expect(callback).toHaveBeenCalledTimes(3)
        expect(retained).toHaveBeenCalledOnce()
        await vi.advanceTimersByTimeAsync(5)
        expect(await afterUnsubscribe).toEqual({ status: 'loaded' })
        await client.dispose()
        expect(await flags.reloadFeatureFlags()).toEqual({ status: 'cancelled' })
        await vi.advanceTimersByTimeAsync(100)
        expect(retained).toHaveBeenCalledOnce()
    })

    it.each(['explicit', 'automatic'] as const)(
        'coalesces a reload requested synchronously from an %s start callback',
        async (trigger) => {
            vi.useFakeTimers()
            const fetch = vi.fn(async () => remoteFlags())
            const client = await createFlags({ refreshIntervalMs: 0 }, { fetch })
            const flags = requireInstalledExtension(client.featureFlags)
            await vi.advanceTimersByTimeAsync(5)
            fetch.mockClear()
            const nested: Promise<FeatureFlagsReloadResult>[] = []
            const callback = vi.fn(() => {
                if (callback.mock.calls.length <= 3) nested.push(flags.reloadFeatureFlags())
            })
            flags.onReloading(callback)
            const outer = trigger === 'explicit' ? flags.reloadFeatureFlags() : undefined
            if (trigger === 'automatic') await requireInstalledExtension(client.analytics).identify('next-person')
            expect(callback).toHaveBeenCalledOnce()
            expect(nested).toHaveLength(1)
            const completion = outer ?? flags.reloadFeatureFlags()
            await Promise.resolve()
            expect(callback).toHaveBeenCalledOnce()
            expect(vi.getTimerCount()).toBe(1)
            expect(fetch).not.toHaveBeenCalled()
            await vi.advanceTimersByTimeAsync(5)
            expect(await Promise.all(nested)).toEqual([{ status: 'loaded' }])
            expect(await completion).toEqual({ status: 'loaded' })
            await vi.advanceTimersByTimeAsync(20)
            expect(callback).toHaveBeenCalledOnce()
            expect(vi.getTimerCount()).toBe(0)
            expect(fetch).toHaveBeenCalledOnce()
        }
    )

    it('shares a failed evaluation outcome with a reload requested from a start callback', async () => {
        vi.useFakeTimers()
        const fetch = vi.fn(async () => remoteFlags())
        const client = await createFlags({ refreshIntervalMs: 0 }, { fetch })
        const flags = requireInstalledExtension(client.featureFlags)
        await vi.advanceTimersByTimeAsync(5)
        fetch.mockClear()
        fetch.mockImplementation(async () => new Response('{}'))
        const nested: Promise<FeatureFlagsReloadResult>[] = []
        const callback = vi.fn(() => {
            if (callback.mock.calls.length <= 3) nested.push(flags.reloadFeatureFlags())
        })
        flags.onReloading(callback)
        const outer = flags.reloadFeatureFlags()
        await vi.advanceTimersByTimeAsync(5)
        expect(await outer).toEqual({ status: 'error' })
        expect(await Promise.all(nested)).toEqual([{ status: 'error' }])
        expect(callback).toHaveBeenCalledOnce()
        expect(fetch).toHaveBeenCalledOnce()
    })

    it('preserves an ordinary in-flight reload as a follow-up request', async () => {
        vi.useFakeTimers()
        const fetch = vi.fn(() => Promise.resolve(remoteFlags()))
        const client = await createFlags({ refreshIntervalMs: 0 }, { fetch })
        const flags = requireInstalledExtension(client.featureFlags)
        await vi.advanceTimersByTimeAsync(5)
        fetch.mockClear()
        const responses: Array<(value: Response) => void> = []
        fetch.mockImplementation(() => new Promise<Response>((resolve) => responses.push(resolve)))
        const callback = vi.fn()
        flags.onReloading(callback)
        const first = flags.reloadFeatureFlags()
        expect(callback).toHaveBeenCalledOnce()
        await vi.advanceTimersByTimeAsync(5)
        expect(fetch).toHaveBeenCalledOnce()
        const followUp = flags.reloadFeatureFlags()
        const completedFollowUp = vi.fn()
        void followUp.then(completedFollowUp)
        expect(callback).toHaveBeenCalledTimes(2)
        await vi.advanceTimersByTimeAsync(5)
        expect(fetch).toHaveBeenCalledOnce()
        responses[0]!(remoteFlags())
        await vi.advanceTimersByTimeAsync(0)
        expect(await first).toEqual({ status: 'loaded' })
        expect(fetch).toHaveBeenCalledTimes(2)
        expect(completedFollowUp).not.toHaveBeenCalled()
        responses[1]!(remoteFlags())
        await vi.advanceTimersByTimeAsync(0)
        expect(await followUp).toEqual({ status: 'loaded' })
        expect(completedFollowUp).toHaveBeenCalledOnce()
        expect(callback).toHaveBeenCalledTimes(2)
        expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('cancels a nested reload disposed before its deferred delegation', async () => {
        vi.useFakeTimers()
        const fetch = vi.fn(async () => remoteFlags())
        const client = await createFlags({ refreshIntervalMs: 0 }, { fetch })
        const flags = requireInstalledExtension(client.featureFlags)
        await vi.advanceTimersByTimeAsync(5)
        fetch.mockClear()
        const delegate = vi.spyOn(PostHogFeatureFlags.prototype, 'reloadFeatureFlagsAsync')
        const nested: Promise<FeatureFlagsReloadResult>[] = []
        const callback = vi.fn(() => {
            if (callback.mock.calls.length <= 3) nested.push(flags.reloadFeatureFlags())
        })
        flags.onReloading(callback)
        const outer = flags.reloadFeatureFlags()
        flags.dispose?.()
        expect(await outer).toEqual({ status: 'cancelled' })
        expect(await Promise.all(nested)).toEqual([{ status: 'cancelled' }])
        expect(delegate).toHaveBeenCalledOnce()
        expect(callback).toHaveBeenCalledOnce()
        await vi.advanceTimersByTimeAsync(10)
        expect(fetch).not.toHaveBeenCalled()
    })

    it('restores synchronous reload starts after a throwing listener', async () => {
        vi.useFakeTimers()
        const client = await createFlags({ refreshIntervalMs: 0 }, { fetch: async () => remoteFlags() })
        const flags = requireInstalledExtension(client.featureFlags)
        await vi.advanceTimersByTimeAsync(5)
        const nested: Promise<FeatureFlagsReloadResult>[] = []
        const callback = vi.fn(() => {
            if (callback.mock.calls.length === 1) {
                nested.push(flags.reloadFeatureFlags())
                throw new Error('callback')
            }
        })
        flags.onReloading(callback)
        const otherListener = vi.fn()
        flags.onReloading(otherListener)
        const first = flags.reloadFeatureFlags()
        expect(callback).toHaveBeenCalledOnce()
        expect(otherListener).toHaveBeenCalledOnce()
        await vi.advanceTimersByTimeAsync(5)
        expect(await first).toEqual({ status: 'loaded' })
        expect(await Promise.all(nested)).toEqual([{ status: 'loaded' }])
        const next = flags.reloadFeatureFlags()
        expect(callback).toHaveBeenCalledTimes(2)
        expect(otherListener).toHaveBeenCalledTimes(2)
        await vi.advanceTimersByTimeAsync(5)
        expect(await next).toEqual({ status: 'loaded' })
    })

    it('contains reload callback errors without preventing other listeners or remote loading', async () => {
        vi.useFakeTimers()
        const client = await createFlags({ refreshIntervalMs: 0 }, { fetch: async () => remoteFlags() })
        const flags = requireInstalledExtension(client.featureFlags)
        await vi.advanceTimersByTimeAsync(5)
        flags.onReloading(() => {
            throw new Error('callback')
        })
        const notified = vi.fn()
        flags.onReloading(notified)
        const reload = flags.reloadFeatureFlags()
        expect(notified).toHaveBeenCalledOnce()
        await vi.advanceTimersByTimeAsync(5)
        expect(await reload).toEqual({ status: 'loaded' })
    })
})

it('coalesces a nested reload requested from the initial automatic start before setup completes', async () => {
    vi.useFakeTimers()
    const flags = featureFlags({ refreshIntervalMs: 0 })
    const nested: Promise<FeatureFlagsReloadResult>[] = []
    const callback = vi.fn(() => {
        if (callback.mock.calls.length <= 3) nested.push(flags.reloadFeatureFlags())
    })
    flags.onReloading(callback)
    const fetch = vi.fn(async () => remoteFlags())
    await create({ extensions: [flags], fetch })
    expect(callback).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(5)
    expect(await Promise.all(nested)).toEqual([{ status: 'loaded' }])
    expect(callback).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledOnce()
})

it('contains delegate and snapshot-copy failures and makes controls inert after disposal', async () => {
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
    const client = await create({ debug: true, flags: { featureFlagEvaluation: false } })
    const flags = requireInstalledExtension(client.featureFlags)
    const error = new Error('delegate')
    const read = vi.spyOn(PostHogFeatureFlags.prototype, 'getFeatureFlagResult').mockImplementation(() => {
        throw error
    })
    const all = vi.spyOn(PostHogFeatureFlags.prototype, 'getAllFeatureFlags').mockImplementation(() => {
        throw error
    })
    const subscribe = vi.spyOn(PostHogFeatureFlags.prototype, 'onReloading').mockImplementation(() => {
        throw error
    })
    expect(flags.getFeatureFlag('test', { sendFeatureFlagEvent: false })).toBeUndefined()
    expect(flags.getAllFeatureFlags()).toEqual([])
    expect(() => flags.onReloading(() => {}).dispose()).not.toThrow()
    expect(logger).toHaveBeenCalledWith(expect.any(String), 'Feature flag read failed', error)
    expect(logger).toHaveBeenCalledWith(expect.any(String), 'Feature flags snapshot failed', error)
    expect(logger).toHaveBeenCalledWith(expect.any(String), 'Feature flags reloading subscription failed', error)
    all.mockReturnValue([
        {
            key: 'test',
            enabled: true,
            variant: undefined,
            payload: {
                get nested(): string {
                    throw error
                },
            },
        },
    ])
    expect(flags.getAllFeatureFlags()).toEqual([])
    await client.dispose()
    read.mockClear()
    all.mockClear()
    subscribe.mockClear()
    expect(flags.getFeatureFlag('test')).toBeUndefined()
    expect(flags.getAllFeatureFlags()).toEqual([])
    expect(() => flags.onReloading(() => {}).dispose()).not.toThrow()
    expect(await flags.reloadFeatureFlags()).toEqual({ status: 'cancelled' })
    expect(read).not.toHaveBeenCalled()
    expect(all).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
})

it('suppresses remaining reload notifications if a listener disposes the flags owner', async () => {
    vi.useFakeTimers()
    const client = await create({ fetch: async () => remoteFlags(), flags: { refreshIntervalMs: 0 } })
    const flags = requireInstalledExtension(client.featureFlags)
    await vi.advanceTimersByTimeAsync(5)
    flags.onReloading(() => flags.dispose?.())
    const afterDispose = vi.fn()
    flags.onReloading(afterDispose)
    await flags.reloadFeatureFlags()
    expect(afterDispose).not.toHaveBeenCalled()
})
