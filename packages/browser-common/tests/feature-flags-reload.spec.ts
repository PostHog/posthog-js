/* oxlint-disable compat/compat */
import type { ApiResponse } from '../src/client'
import type { FeatureFlagsConfig } from '../src/feature-flags-config'
import { PostHogFeatureFlags } from '../src/feature-flags'
import { createTestClient } from './helpers/test-client'

const instances: PostHogFeatureFlags[] = []
async function setup(overrides: Partial<FeatureFlagsConfig> = {}) {
    const config: FeatureFlagsConfig = {
        bootstrap: {},
        remoteRequestsDisabled: false,
        featureFlagsDisabled: false,
        onlyEvaluateSurveyFeatureFlags: false,
        deduplicateCallsPerSession: false,
        idleRefreshBackoff: false,
        requestTimeoutMs: 3000,
        evaluationContexts: [],
        ...overrides,
    }
    const client = createTestClient()
    const flags = new PostHogFeatureFlags({ get: () => config })
    instances.push(flags)
    await flags.setup(client)
    return { flags, client, config }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
    instances.splice(0).forEach((flags) => flags.dispose())
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('awaitable feature flag reloads', () => {
    it('coalesces debounced callers and resolves after flags are applied', async () => {
        const { flags, client } = await setup()
        const request = vi
            .spyOn(client, 'sendRequest')
            .mockResolvedValue({ statusCode: 200, json: { featureFlags: { test: 'fresh' } } })
        const first = flags.reloadFeatureFlagsAsync()
        const second = flags.reloadFeatureFlagsAsync()
        await vi.advanceTimersByTimeAsync(5)
        expect(await first).toEqual({ status: 'loaded' })
        expect(await second).toEqual({ status: 'loaded' })
        expect(request).toHaveBeenCalledTimes(1)
        expect(flags.getFeatureFlag('test')).toBe('fresh')
    })

    it('does not resolve from bootstrap, injected values or an earlier in-flight request', async () => {
        const { flags, client } = await setup({ bootstrap: { featureFlags: { test: 'bootstrap' } } })
        const responses: Array<(response: ApiResponse) => void> = []
        const request = vi
            .spyOn(client, 'sendRequest')
            .mockImplementation(() => new Promise((resolve) => responses.push(resolve)))
        const first = flags.reloadFeatureFlagsAsync()
        await vi.advanceTimersByTimeAsync(5)
        const done = vi.fn()
        const second = flags.reloadFeatureFlagsAsync().then(done)
        flags.updateFlags({ test: 'local' })
        await vi.advanceTimersByTimeAsync(5)
        expect(done).not.toHaveBeenCalled()
        responses[0]!({ statusCode: 200, json: { featureFlags: { test: 'first' } } })
        await vi.advanceTimersByTimeAsync(0)
        expect(await first).toEqual({ status: 'loaded' })
        expect(request).toHaveBeenCalledTimes(2)
        expect(done).not.toHaveBeenCalled()
        responses[1]!({ statusCode: 200, json: { featureFlags: { test: 'second' } } })
        await second
        expect(done).toHaveBeenCalledWith({ status: 'loaded' })
        expect(flags.getFeatureFlag('test')).toBe('second')
    })

    it.each([
        { statusCode: 200 },
        { statusCode: 200, json: {} },
        { statusCode: 500, json: {} },
        { statusCode: 0, error: new Error('network') },
        { statusCode: 200, json: { errorsWhileComputingFlags: true, featureFlags: {} } },
        { statusCode: 200, json: { quotaLimited: ['feature_flags'] } },
    ])('reports request and evaluation failures: %j', async (response) => {
        const { flags, client } = await setup()
        vi.spyOn(client, 'sendRequest').mockResolvedValue(response)
        const reload = flags.reloadFeatureFlagsAsync()
        await vi.advanceTimersByTimeAsync(5)
        expect(await reload).toEqual({ status: 'error' })
    })

    it.each(['throw', 'reject'])('settles a transport %s without a persisted fallback', async (mode) => {
        const { flags, client } = await setup()
        vi.spyOn(client, 'sendRequest').mockImplementation(() => {
            if (mode === 'throw') throw new Error('network')
            return Promise.reject(new Error('network'))
        })
        const reload = flags.reloadFeatureFlagsAsync()
        await vi.advanceTimersByTimeAsync(5)
        expect(await reload).toEqual({ status: 'error' })
    })

    it.each([{ featureFlags: {} }, { flags: {} }])(
        'treats an empty successful evaluation as loaded: %j',
        async (json) => {
            const { flags, client } = await setup()
            vi.spyOn(client, 'sendRequest').mockResolvedValue({ statusCode: 200, json })
            const reload = flags.reloadFeatureFlagsAsync()
            await vi.advanceTimersByTimeAsync(5)
            expect(await reload).toEqual({ status: 'loaded' })
        }
    )

    it.each([{ featureFlagsDisabled: true }, { remoteRequestsDisabled: true }])(
        'skips disabled evaluation: %j',
        async (config) => {
            const { flags, client } = await setup(config)
            expect(await flags.reloadFeatureFlagsAsync()).toEqual({ status: 'skipped' })
            expect(client.sentRequests).toEqual([])
        }
    )

    it('skips paused evaluation and requests disabled during debounce', async () => {
        const { flags, client, config } = await setup()
        flags.setReloadingPaused(true)
        expect(await flags.reloadFeatureFlagsAsync()).toEqual({ status: 'skipped' })
        flags.setReloadingPaused(false)
        const reload = flags.reloadFeatureFlagsAsync()
        config.remoteRequestsDisabled = true
        await vi.advanceTimersByTimeAsync(5)
        expect(await reload).toEqual({ status: 'skipped' })
        expect(client.sentRequests).toEqual([])
    })

    it('skips new callers after the reachability circuit breaker trips', async () => {
        const { flags, client } = await setup()
        vi.stubGlobal('window', { navigator: { onLine: true } })
        vi.spyOn(client, 'sendRequest').mockResolvedValue({ statusCode: 0 })
        for (let i = 0; i < 3; i++) {
            const reload = flags.reloadFeatureFlagsAsync()
            await vi.advanceTimersByTimeAsync(5)
            expect(await reload).toEqual({ status: 'error' })
        }
        expect(await flags.reloadFeatureFlagsAsync()).toEqual({ status: 'skipped' })
    })

    it.each(['reset', 'dispose'] as const)('cancels pending and in-flight reloads on %s', async (operation) => {
        const { flags, client } = await setup()
        vi.spyOn(client, 'sendRequest').mockImplementation(() => new Promise(() => {}))
        const active = flags.reloadFeatureFlagsAsync()
        await vi.advanceTimersByTimeAsync(5)
        const pending = flags.reloadFeatureFlagsAsync()
        flags[operation]()
        expect(await active).toEqual({ status: 'cancelled' })
        expect(await pending).toEqual({ status: 'cancelled' })
    })

    it('does not settle a post-reset reload from the obsolete response', async () => {
        const { flags, client } = await setup()
        const responses: Array<(response: ApiResponse) => void> = []
        vi.spyOn(client, 'sendRequest').mockImplementation(() => new Promise((resolve) => responses.push(resolve)))
        const old = flags.reloadFeatureFlagsAsync()
        await vi.advanceTimersByTimeAsync(5)
        flags.reset()
        expect(await old).toEqual({ status: 'cancelled' })
        const done = vi.fn()
        const fresh = flags.reloadFeatureFlagsAsync().then(done)
        responses[0]!({ statusCode: 200, json: { featureFlags: { old: true } } })
        await vi.advanceTimersByTimeAsync(5)
        expect(done).not.toHaveBeenCalled()
        responses[1]!({ statusCode: 200, json: { featureFlags: { fresh: true } } })
        await fresh
        expect(done).toHaveBeenCalledWith({ status: 'loaded' })
        expect(flags.getFeatureFlag('old')).toBeUndefined()
        expect(flags.getFeatureFlag('fresh')).toBe(true)
    })
})
