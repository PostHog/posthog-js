import { PostHogFeatureFlags } from '@posthog/browser-common/feature-flags'
import { createPostHog } from '../src/composition/npm'
import type { IPostHog, PostHogOptions } from '../src/core/types'
import { createAnalyticsExtension } from '../src/products/analytics/analytics-buffer'
import type { IFeatureFlags } from '../src/products/flags/flags'
import { localRemoteConfig, MemoryStorage, requireInstalledExtension } from './helpers'

const clients: IPostHog[] = []
const create = async (options: Partial<PostHogOptions> = {}) => {
    const requests: Record<string, unknown>[] = []
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(JSON.parse(String(init?.body)))
        return new Response(JSON.stringify({ featureFlags: { retained: true } }))
    })
    const client = await createPostHog({
        projectToken: 'ph_flags_local_overrides',
        capturePageview: false,
        storage: false,
        navigator: false,
        analytics: false,
        remoteConfig: localRemoteConfig,
        flags: { refreshIntervalMs: 0 },
        fetch,
        ...options,
    })
    clients.push(client)
    const flags = requireInstalledExtension(client.featureFlags)
    await vi.advanceTimersByTimeAsync(5)
    fetch.mockClear()
    requests.splice(0)
    return { client, flags, fetch, requests }
}
const reload = async (flags: IFeatureFlags) => {
    const result = flags.reloadFeatureFlags()
    await vi.advanceTimersByTimeAsync(5)
    expect(await result).toEqual({ status: 'loaded' })
}
const identity = (client: IPostHog) => ({
    distinctId: client.distinctId,
    anonymousId: client.anonymousId,
    deviceId: client.deviceId,
    groups: client.groups,
    session: client.session,
})

beforeEach(() => {
    vi.useFakeTimers()
})
afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.dispose()))
    vi.restoreAllMocks()
    vi.useRealTimers()
})

describe('local flag evaluation overrides', () => {
    it('merges person overrides and per-group properties in subsequent reload requests', async () => {
        const { flags, fetch, requests } = await create()
        flags.setPersonPropertiesForFlags({ plan: 'free', region: 'west' }, false)
        flags.setPersonPropertiesForFlags({ plan: 'pro', seats: 5 }, false)
        flags.setGroupPropertiesForFlags({ company: { plan: 'free', size: 2 }, project: { stage: 'beta' } }, false)
        flags.setGroupPropertiesForFlags({ company: { plan: 'pro' }, team: { active: true } }, false)
        await vi.advanceTimersByTimeAsync(10)
        expect(fetch).not.toHaveBeenCalled()
        await reload(flags)
        expect(requests).toEqual([
            expect.objectContaining({
                person_properties: expect.objectContaining({ plan: 'pro', region: 'west', seats: 5 }),
                group_properties: {
                    company: { plan: 'pro', size: 2 },
                    project: { stage: 'beta' },
                    team: { active: true },
                },
                groups: {},
            }),
        ])
    })

    it.each(['person', 'group', 'person reset'] as const)(
        '%s reloads by default and with true, but not with false',
        async (operation) => {
            const { flags, fetch, requests } = await create()
            const apply = (reloadFeatureFlags?: boolean) => {
                if (operation === 'person') flags.setPersonPropertiesForFlags({ plan: 'pro' }, reloadFeatureFlags)
                else if (operation === 'group')
                    flags.setGroupPropertiesForFlags({ company: { plan: 'pro' } }, reloadFeatureFlags)
                else flags.resetPersonPropertiesForFlags(reloadFeatureFlags)
            }
            for (const setting of [undefined, true, false]) {
                flags.setPersonPropertiesForFlags({ old: true }, false)
                fetch.mockClear()
                requests.splice(0)
                apply(setting)
                await vi.advanceTimersByTimeAsync(5)
                expect(fetch).toHaveBeenCalledTimes(setting === false ? 0 : 1)
                if (setting === false) await reload(flags)
                if (operation === 'person reset') expect(requests[0]?.person_properties).not.toHaveProperty('old')
                else if (operation === 'person')
                    expect(requests[0]?.person_properties).toMatchObject({ old: true, plan: 'pro' })
                else expect(requests[0]?.group_properties).toEqual({ company: { plan: 'pro' } })
            }
        }
    )

    it('clears person, selective group and all-group scopes without affecting cached flag values', async () => {
        const { flags, fetch, requests } = await create()
        flags.setPersonPropertiesForFlags({ plan: 'pro' }, false)
        flags.setGroupPropertiesForFlags({ company: { size: 5 }, project: { stage: 'beta' } }, false)
        flags.resetGroupPropertiesForFlags('company')
        flags.resetGroupPropertiesForFlags('company')
        flags.resetGroupPropertiesForFlags('missing')
        await vi.advanceTimersByTimeAsync(10)
        expect(fetch).not.toHaveBeenCalled()
        await reload(flags)
        expect(requests.at(-1)).toMatchObject({
            person_properties: { plan: 'pro' },
            group_properties: { company: {}, project: { stage: 'beta' }, missing: {} },
        })
        flags.resetPersonPropertiesForFlags(false)
        await reload(flags)
        expect(requests.at(-1)?.person_properties).not.toHaveProperty('plan')
        expect(requests.at(-1)?.group_properties).toMatchObject({ project: { stage: 'beta' } })
        fetch.mockClear()
        flags.resetGroupPropertiesForFlags()
        flags.resetGroupPropertiesForFlags()
        await vi.advanceTimersByTimeAsync(10)
        expect(fetch).not.toHaveBeenCalled()
        await reload(flags)
        expect(requests.at(-1)?.group_properties).toBeUndefined()
        expect(flags.getFeatureFlag('retained')?.enabled).toBe(true)
    })

    it.each(['allowed', 'denied', 'absent'] as const)(
        'keeps controls local when analytics is %s',
        async (analytics) => {
            const { client, flags, requests } = await create({
                optOutByDefault: analytics === 'denied',
                extensions: analytics === 'absent' ? [] : [createAnalyticsExtension()],
            })
            const captured = vi.fn()
            client.analytics?.onEvent(captured)
            const identified = vi.fn()
            const grouped = vi.fn()
            const reset = vi.fn()
            const session = vi.fn()
            client.onIdentify(identified)
            client.onGroup(grouped)
            client.onReset(reset)
            client.onNewSession(session)
            const before = identity(client)
            flags.setPersonPropertiesForFlags({ plan: 'pro' })
            flags.setGroupPropertiesForFlags({ company: { size: 5 } })
            await vi.advanceTimersByTimeAsync(5)
            if (analytics === 'denied') {
                expect(requests).toEqual([])
                client.optIn()
                await reload(flags)
            }
            expect(requests.at(-1)).toMatchObject({
                person_properties: { plan: 'pro' },
                group_properties: { company: { size: 5 } },
            })
            if (analytics === 'denied') client.optOut()
            flags.resetPersonPropertiesForFlags()
            flags.resetGroupPropertiesForFlags()
            await vi.advanceTimersByTimeAsync(5)
            if (analytics === 'denied') {
                client.optIn()
                await reload(flags)
            }
            expect(requests.at(-1)?.person_properties).not.toHaveProperty('plan')
            expect(requests.at(-1)?.group_properties).toBeUndefined()
            expect(identity(client)).toEqual(before)
            for (const callback of [captured, identified, grouped, reset, session])
                expect(callback).not.toHaveBeenCalled()
            if (analytics === 'absent') expect(client.analytics).toBeUndefined()
            else {
                client.optIn()
                client.analytics?.capture('after overrides')
                expect(captured).toHaveBeenCalledOnce()
                expect(captured.mock.calls[0]?.[0].properties.$process_person_profile).toBe(false)
            }
        }
    )

    it('persists merges and scoped resets across recreation, and clears all overrides on full reset', async () => {
        const storage = new MemoryStorage()
        const first = await create({ storage })
        first.flags.setPersonPropertiesForFlags({ plan: 'pro' }, false)
        first.flags.setGroupPropertiesForFlags({ company: { size: 5 }, project: { stage: 'beta' } }, false)
        await first.client.dispose()
        const second = await create({ storage, extensions: [createAnalyticsExtension()] })
        await reload(second.flags)
        expect(second.requests.at(-1)).toMatchObject({
            person_properties: { plan: 'pro' },
            group_properties: { company: { size: 5 }, project: { stage: 'beta' } },
        })
        second.flags.resetPersonPropertiesForFlags(false)
        second.flags.resetGroupPropertiesForFlags('company')
        await second.client.dispose()
        const third = await create({ storage, extensions: [createAnalyticsExtension()] })
        await reload(third.flags)
        expect(third.requests.at(-1)?.person_properties).not.toHaveProperty('plan')
        expect(third.requests.at(-1)?.group_properties).toEqual({ company: {}, project: { stage: 'beta' } })
        third.flags.setPersonPropertiesForFlags({ restored: true }, false)
        requireInstalledExtension(third.client.analytics).reset()
        await vi.advanceTimersByTimeAsync(5)
        expect(third.requests.at(-1)?.person_properties).not.toHaveProperty('restored')
        expect(third.requests.at(-1)?.group_properties).toBeUndefined()
        await third.client.dispose()
        const fourth = await create({ storage })
        await reload(fourth.flags)
        expect(fourth.requests.at(-1)?.person_properties).not.toHaveProperty('restored')
        expect(fourth.requests.at(-1)?.group_properties).toBeUndefined()
    })

    it('retains local mutations after reload failure and contains delegate errors', async () => {
        const { flags, fetch, requests } = await create()
        fetch.mockRejectedValueOnce(new Error('offline'))
        flags.setPersonPropertiesForFlags({ plan: 'pro' })
        flags.setGroupPropertiesForFlags({ company: { size: 5 } }, false)
        await vi.advanceTimersByTimeAsync(5)
        await reload(flags)
        expect(requests.at(-1)).toMatchObject({
            person_properties: { plan: 'pro' },
            group_properties: { company: { size: 5 } },
        })
        fetch.mockRejectedValueOnce(new Error('offline'))
        flags.resetPersonPropertiesForFlags()
        flags.resetGroupPropertiesForFlags()
        await vi.advanceTimersByTimeAsync(5)
        await reload(flags)
        expect(requests.at(-1)?.person_properties).not.toHaveProperty('plan')
        expect(requests.at(-1)?.group_properties).toBeUndefined()
        for (const method of [
            'setPersonPropertiesForFlags',
            'resetPersonPropertiesForFlags',
            'setGroupPropertiesForFlags',
            'resetGroupPropertiesForFlags',
        ] as const) {
            const delegate = vi.spyOn(PostHogFeatureFlags.prototype, method).mockImplementation(() => {
                throw new Error('delegate failure')
            })
            expect(() => {
                flags.setPersonPropertiesForFlags({}, false)
                flags.resetPersonPropertiesForFlags(false)
                flags.setGroupPropertiesForFlags({}, false)
                flags.resetGroupPropertiesForFlags()
            }).not.toThrow()
            expect(delegate).toHaveBeenCalledOnce()
            delegate.mockRestore()
        }
    })

    it('keeps local context usable when durable storage writes fail', async () => {
        const storage = new MemoryStorage()
        const { flags, requests } = await create({ storage })
        vi.spyOn(storage, 'setItem').mockImplementation(() => {
            throw new Error('storage unavailable')
        })
        expect(() => {
            flags.setPersonPropertiesForFlags({ plan: 'pro' }, false)
            flags.setGroupPropertiesForFlags({ company: { size: 5 } }, false)
        }).not.toThrow()
        await reload(flags)
        expect(requests.at(-1)).toMatchObject({
            person_properties: { plan: 'pro' },
            group_properties: { company: { size: 5 } },
        })
        expect(() => {
            flags.resetPersonPropertiesForFlags(false)
            flags.resetGroupPropertiesForFlags()
        }).not.toThrow()
        await reload(flags)
        expect(requests.at(-1)?.person_properties).not.toHaveProperty('plan')
        expect(requests.at(-1)?.group_properties).toBeUndefined()
    })

    it('cancels scheduled reloads and keeps all controls inert after disposal', async () => {
        const { client, flags, fetch } = await create()
        flags.setPersonPropertiesForFlags({ beforeDisposal: true })
        const methods = [
            vi.spyOn(PostHogFeatureFlags.prototype, 'setPersonPropertiesForFlags'),
            vi.spyOn(PostHogFeatureFlags.prototype, 'resetPersonPropertiesForFlags'),
            vi.spyOn(PostHogFeatureFlags.prototype, 'setGroupPropertiesForFlags'),
            vi.spyOn(PostHogFeatureFlags.prototype, 'resetGroupPropertiesForFlags'),
        ]
        await client.dispose()
        flags.setPersonPropertiesForFlags({ late: true })
        flags.resetPersonPropertiesForFlags()
        flags.setGroupPropertiesForFlags({ company: { late: true } })
        flags.resetGroupPropertiesForFlags()
        await vi.advanceTimersByTimeAsync(10)
        for (const method of methods) expect(method).not.toHaveBeenCalled()
        expect(fetch).not.toHaveBeenCalled()
    })
})
