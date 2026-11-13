import { PostHogFeatureFlags } from '@posthog/browser-common/feature-flags'
import type { EarlyAccessFeature, EarlyAccessFeatureStage } from '@posthog/types'
import type { IPostHog, PostHogOptions } from '../src/core/types'
import { featureFlags } from '../src/products/flags/flags'
import { createBufferedRootPostHog as createPostHog, localRemoteConfig, requireInstalledExtension } from './helpers'

const beta: EarlyAccessFeature = {
    name: 'New onboarding',
    description: 'Try the new onboarding flow',
    stage: 'beta',
    documentationUrl: 'https://example.com/onboarding',
    payload: { version: 2 },
    flagKey: 'onboarding',
}
const concept: EarlyAccessFeature = { ...beta, name: 'Concept', stage: 'concept', flagKey: null }
const definitions = [beta, concept]
const clients: IPostHog[] = []
const create = async (options: Partial<PostHogOptions> = {}) => {
    const client = await createPostHog({
        projectToken: 'ph_early_access_test',
        apiHost: 'https://example.com',
        storage: false,
        navigator: false,
        capturePageview: false,
        remoteConfig: localRemoteConfig,
        flags: { featureFlagEvaluation: false },
        fetch: false,
        ...options,
    })
    clients.push(client)
    return client
}
const listing = (client: IPostHog, forceReload?: boolean, stages?: EarlyAccessFeatureStage[]) =>
    new Promise<EarlyAccessFeature[]>((resolve) =>
        requireInstalledExtension(client.featureFlags).getEarlyAccessFeatures(resolve, forceReload, stages)
    )

afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.dispose()))
    vi.restoreAllMocks()
    vi.useRealTimers()
})

describe('early-access feature flags', () => {
    it.each(['automatic', 'static'])('reuses shared listing and cache through %s flags', async (mode) => {
        const fetch = vi.fn(async () => new Response(JSON.stringify({ earlyAccessFeatures: definitions })))
        const client = await create({
            fetch,
            ...(mode === 'static' ? { extensions: [featureFlags({ featureFlagEvaluation: false })] } : {}),
        })
        expect(await listing(client)).toEqual(definitions)
        expect(fetch).toHaveBeenCalledOnce()
        const [input, init] = (fetch.mock.calls as unknown as Array<[string, RequestInit]>)[0]!
        const url = new URL(input)
        expect(url.origin).toBe('https://example.com')
        expect(url.pathname).toBe('/api/early_access_features/')
        expect(url.searchParams.get('token')).toBe('ph_early_access_test')
        expect(url.searchParams.has('stage')).toBe(false)
        expect(init.method).toBe('GET')

        const cached = vi.fn()
        requireInstalledExtension(client.featureFlags).getEarlyAccessFeatures(cached, false, ['alpha'])
        expect(cached).toHaveBeenCalledWith(definitions)
        expect(fetch).toHaveBeenCalledOnce()

        fetch.mockImplementation(async () => new Response(JSON.stringify({ earlyAccessFeatures: [beta] })))
        expect(await listing(client, true, ['beta', 'general-availability'])).toEqual([beta])
        expect(fetch).toHaveBeenCalledTimes(2)
        const forcedUrl = new URL((fetch.mock.calls as unknown as Array<[string]>)[1]![0])
        expect(forcedUrl.searchParams.getAll('stage')).toEqual(['beta', 'general-availability'])
        expect(await listing(client)).toEqual([beta])
        expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('forwards empty stage filters and reuses an empty cached response', async () => {
        const fetch = vi.fn(async () => new Response(JSON.stringify({ earlyAccessFeatures: [] })))
        const client = await create({ fetch })
        expect(await listing(client, false, [])).toEqual([])
        expect(new URL((fetch.mock.calls as unknown as Array<[string]>)[0]![0]).searchParams.has('stage')).toBe(false)
        expect(await listing(client)).toEqual([])
        expect(fetch).toHaveBeenCalledOnce()
    })

    it.each([
        [true, undefined],
        [false, 'beta'],
        [true, 'custom-stage'],
    ] as const)('updates enrollment to %s with stage %s and cached metadata', async (isEnrolled, stage) => {
        vi.useFakeTimers()
        const fetch = vi.fn(
            async (input: RequestInfo | URL) =>
                new Response(
                    JSON.stringify(
                        new URL(String(input)).pathname === '/api/early_access_features/'
                            ? { earlyAccessFeatures: definitions }
                            : { featureFlags: { retained: 'blue' } }
                    )
                )
        )
        const client = await create({ fetch, flags: { refreshIntervalMs: 0 } })
        await vi.advanceTimersByTimeAsync(5)
        const flags = requireInstalledExtension(client.featureFlags)
        const analytics = requireInstalledExtension(client.analytics)
        await analytics.identify('member', { plan: 'paid' })
        await analytics.group('organization', 'acme', { region: 'west' })
        await vi.advanceTimersByTimeAsync(5)
        expect(await listing(client)).toEqual(definitions)
        const identity = { distinctId: client.distinctId, deviceId: client.deviceId, groups: client.groups }
        const events = vi.fn()
        analytics.onEvent(events)
        const identify = vi.spyOn(analytics, 'identify')
        const group = vi.spyOn(analytics, 'group')
        const callbacks = vi.fn()
        flags.onFeatureFlags(callbacks)
        callbacks.mockClear()
        fetch.mockClear()

        flags.updateEarlyAccessFeatureEnrollment('onboarding', isEnrolled, stage)

        expect(callbacks).toHaveBeenCalledOnce()
        expect(callbacks).toHaveBeenCalledWith(
            expect.arrayContaining([expect.objectContaining({ key: 'onboarding', enabled: isEnrolled })]),
            false
        )
        expect(events).toHaveBeenCalledOnce()
        expect(events.mock.calls[0]![0]).toMatchObject({
            event: '$feature_enrollment_update',
            properties: {
                $feature_flag: 'onboarding',
                $feature_enrollment: isEnrolled,
                $early_access_feature_name: beta.name,
                $set: { '$feature_enrollment/onboarding': isEnrolled },
            },
        })
        expect(events.mock.calls[0]![0].properties.$feature_enrollment_stage).toBe(stage)
        expect(flags.getFeatureFlag('onboarding')?.enabled).toBe(isEnrolled)
        expect(flags.getFeatureFlag('retained')?.variant).toBe('blue')
        expect({ distinctId: client.distinctId, deviceId: client.deviceId, groups: client.groups }).toEqual(identity)
        expect(identify).not.toHaveBeenCalled()
        expect(group).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(5)
        expect(fetch).not.toHaveBeenCalled()

        const reload = flags.reloadFeatureFlags()
        await vi.advanceTimersByTimeAsync(5)
        await reload
        const body = JSON.parse(String((fetch.mock.calls as unknown as Array<[string, RequestInit]>)[0]![1].body))
        expect(body).toMatchObject({
            distinct_id: 'member',
            groups: { organization: 'acme' },
            person_properties: { plan: 'paid', '$feature_enrollment/onboarding': isEnrolled },
            group_properties: { organization: { region: 'west' } },
        })
    })

    it('lists uncached features under consent denial', async () => {
        vi.useFakeTimers()
        const fetch = vi.fn(async () => new Response(JSON.stringify({ earlyAccessFeatures: definitions })))
        const client = await create({ fetch, optOutByDefault: true })
        const callback = vi.fn()
        requireInstalledExtension(client.featureFlags).getEarlyAccessFeatures(callback)
        await vi.advanceTimersByTimeAsync(0)
        expect(fetch).toHaveBeenCalledOnce()
        expect(callback).toHaveBeenCalledWith(definitions)
    })

    it('gates enrollment capture but retains local updates and cached listing under consent denial', async () => {
        const fetch = vi.fn(async () => new Response(JSON.stringify({ earlyAccessFeatures: definitions })))
        const client = await create({ fetch })
        expect(await listing(client)).toEqual(definitions)
        client.optOut()
        const flags = requireInstalledExtension(client.featureFlags)
        const captured = vi.fn()
        requireInstalledExtension(client.analytics).onEvent(captured)
        expect(await listing(client)).toEqual(definitions)
        expect(fetch).toHaveBeenCalledOnce()
        flags.updateEarlyAccessFeatureEnrollment('onboarding', true)
        expect(captured).not.toHaveBeenCalled()
        expect(flags.getFeatureFlag('onboarding')?.enabled).toBe(true)
        const enrollments = () =>
            captured.mock.calls.map(([event]) => event).filter((event) => event.event === '$feature_enrollment_update')
        client.optIn()
        flags.updateEarlyAccessFeatureEnrollment('uncached', false)
        expect(enrollments()).toHaveLength(1)
        expect(enrollments()[0].properties.$early_access_feature_name).toBeUndefined()
        expect(enrollments()[0].properties.$feature_enrollment_stage).toBeUndefined()
        client.optOut()
        flags.updateEarlyAccessFeatureEnrollment('onboarding', false)
        expect(enrollments()).toHaveLength(1)
        expect(flags.getFeatureFlag('onboarding')?.enabled).toBe(false)
    })

    it('contains application callback exceptions on both fetched and cached delivery', async () => {
        vi.useFakeTimers()
        const client = await create({
            fetch: async () => new Response(JSON.stringify({ earlyAccessFeatures: definitions })),
        })
        const callback = vi.fn(() => {
            throw new Error('application callback')
        })
        const flags = requireInstalledExtension(client.featureFlags)
        expect(() => flags.getEarlyAccessFeatures(callback)).not.toThrow()
        await vi.advanceTimersByTimeAsync(0)
        expect(callback).toHaveBeenCalledOnce()
        expect(() => flags.getEarlyAccessFeatures(callback)).not.toThrow()
        expect(callback).toHaveBeenCalledTimes(2)
        expect(await listing(client)).toEqual(definitions)
    })

    it.each([false, true])('suppresses in-flight callbacks after disposal (forced: %s)', async (forced) => {
        vi.useFakeTimers()
        let complete!: (response: Response) => void
        const fetch = vi.fn(async () => new Response(JSON.stringify({ earlyAccessFeatures: definitions })))
        const client = await create({ fetch })
        if (forced) expect(await listing(client)).toEqual(definitions)
        fetch.mockClear()
        fetch.mockImplementation(() => new Promise<Response>((resolve) => (complete = resolve)))
        const flags = requireInstalledExtension(client.featureFlags)
        const callback = vi.fn()
        flags.getEarlyAccessFeatures(callback, forced)
        expect(fetch).toHaveBeenCalledOnce()
        await client.dispose()
        complete(new Response(JSON.stringify({ earlyAccessFeatures: [beta] })))
        await vi.advanceTimersByTimeAsync(0)
        expect(callback).not.toHaveBeenCalled()
        const list = vi.spyOn(PostHogFeatureFlags.prototype, 'getEarlyAccessFeatures')
        const enroll = vi.spyOn(PostHogFeatureFlags.prototype, 'updateEarlyAccessFeatureEnrollment')
        flags.getEarlyAccessFeatures(callback)
        flags.getEarlyAccessFeatures(callback, true, ['beta'])
        flags.updateEarlyAccessFeatureEnrollment('onboarding', true)
        expect(callback).not.toHaveBeenCalled()
        expect(list).not.toHaveBeenCalled()
        expect(enroll).not.toHaveBeenCalled()
        expect(fetch).toHaveBeenCalledOnce()
    })

    it('prevents cached delivery and enrollment after disposal', async () => {
        const fetch = vi.fn(async () => new Response(JSON.stringify({ earlyAccessFeatures: definitions })))
        const client = await create({ fetch })
        expect(await listing(client)).toEqual(definitions)
        const flags = requireInstalledExtension(client.featureFlags)
        const enroll = vi.spyOn(PostHogFeatureFlags.prototype, 'updateEarlyAccessFeatureEnrollment')
        await client.dispose()
        const callback = vi.fn()
        flags.getEarlyAccessFeatures(callback)
        flags.updateEarlyAccessFeatureEnrollment('onboarding', true)
        expect(callback).not.toHaveBeenCalled()
        expect(enroll).not.toHaveBeenCalled()
        expect(fetch).toHaveBeenCalledOnce()
    })

    it('contains listing and enrollment delegate failures', async () => {
        const client = await create()
        const flags = requireInstalledExtension(client.featureFlags)
        vi.spyOn(PostHogFeatureFlags.prototype, 'getEarlyAccessFeatures').mockImplementation(() => {
            throw new Error('listing delegate')
        })
        vi.spyOn(PostHogFeatureFlags.prototype, 'updateEarlyAccessFeatureEnrollment').mockImplementation(() => {
            throw new Error('enrollment delegate')
        })
        const callback = vi.fn()
        expect(() => flags.getEarlyAccessFeatures(callback, true, ['beta'])).not.toThrow()
        expect(() => flags.updateEarlyAccessFeatureEnrollment('onboarding', true, 'beta')).not.toThrow()
        expect(callback).not.toHaveBeenCalled()
        const captured = vi.fn()
        const analytics = requireInstalledExtension(client.analytics)
        analytics.onEvent(captured)
        analytics.capture('still usable')
        expect(captured).toHaveBeenCalledOnce()
    })
})
