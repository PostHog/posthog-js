/* oxlint-disable compat/compat */
import type { FeatureFlagsConfig } from '../src/feature-flags-config'
import { PostHogFeatureFlags } from '../src/feature-flags'
import { ENABLED_FEATURE_FLAGS, PERSISTENCE_FEATURE_FLAG_PAYLOADS } from '../src/constants'
import { createTestClient } from './helpers/test-client'

function createConfig(overrides: Partial<FeatureFlagsConfig> = {}): FeatureFlagsConfig {
    return {
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
}

describe('PostHogFeatureFlags with a shared Client', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('uses transient bootstrap values without replacing durable flags', async () => {
        const client = createTestClient()
        client.kv.set(ENABLED_FEATURE_FLAGS, { flag: 'cached' })
        const config = createConfig({
            bootstrap: { featureFlags: { flag: 'bootstrap' }, featureFlagPayloads: { flag: { source: 'bootstrap' } } },
        })
        const flags = new PostHogFeatureFlags({ get: () => config })

        expect(client.sentRequests).toEqual([])
        expect(client.capturedEvents).toEqual([])
        await flags.setup(client)

        expect(flags.getFeatureFlag('flag', { send_event: false })).toBe('bootstrap')
        expect(flags.getFeatureFlagPayload('flag')).toEqual({ source: 'bootstrap' })
        expect(client.kv.get(ENABLED_FEATURE_FLAGS)).toEqual({ flag: 'cached' })
        client.capture('test')
        expect(client.capturedEvents[0]?.properties['$feature/flag']).toBe('bootstrap')

        flags.dispose()
        flags.dispose()
        client.capture('after disposal')
        expect(client.capturedEvents[1]?.properties).not.toHaveProperty('$feature/flag')
    })

    it('loads flags through the shared transport and persists the response before callbacks', async () => {
        const client = createTestClient({
            requestResponse: {
                statusCode: 200,
                json: { flags: { flag: { key: 'flag', enabled: true, metadata: { payload: '{"value":1}' } } } },
            },
        })
        const config = createConfig({ evaluationContexts: ['production'], flagKeys: ['flag'], requestTimeoutMs: 1234 })
        const flags = new PostHogFeatureFlags({ get: () => config })
        await flags.setup(client)
        const callback = vi.fn(() => ({
            flags: client.kv.get(ENABLED_FEATURE_FLAGS),
            payloads: client.kv.get(PERSISTENCE_FEATURE_FLAG_PAYLOADS),
        }))
        flags.onFeatureFlags(callback)
        flags.ensureFlagsLoaded()
        await vi.advanceTimersByTimeAsync(5)

        expect(client.sentRequests).toEqual([
            {
                path: '/flags/?v=2',
                init: expect.objectContaining({
                    target: 'flags',
                    method: 'POST',
                    sentAt: 'body',
                    timeoutMs: 1234,
                    body: expect.objectContaining({
                        token: client.projectToken,
                        distinct_id: client.distinctId,
                        evaluation_contexts: ['production'],
                        flag_keys: ['flag'],
                    }),
                }),
            },
        ])
        expect(callback).toHaveBeenCalledWith(['flag'], { flag: true }, { errorsLoading: false })
        expect(callback).toHaveReturnedWith({ flags: { flag: true }, payloads: { flag: '{"value":1}' } })
        expect(flags.getFeatureFlag('flag')).toBe(true)
        expect(client.capturedEvents[0]).toMatchObject({ event: '$feature_flag_called' })
        flags.dispose()
    })

    it('reads configuration changes from the supplied source and disables requests', async () => {
        const client = createTestClient()
        let config = createConfig()
        const flags = new PostHogFeatureFlags({ get: () => config })
        await flags.setup(client)
        config = createConfig({ featureFlagsDisabled: true })
        flags.reloadFeatureFlags()
        await vi.advanceTimersByTimeAsync(5)
        expect(client.sentRequests).toEqual([])
        flags.dispose()
    })

    it('does not finish setup after disposal while KV initialization is pending', async () => {
        const client = createTestClient()
        let finishInitialization!: () => void
        vi.spyOn(client.kv, 'initialize').mockImplementation(
            () => new Promise<void>((resolve) => (finishInitialization = resolve))
        )
        const registerProperties = vi.spyOn(client, 'registerDynamicEventProperties')
        const flags = new PostHogFeatureFlags({ get: () => createConfig() })
        const setup = flags.setup(client)
        flags.dispose()
        finishInitialization()
        await setup
        expect(registerProperties).not.toHaveBeenCalled()
        expect(client.sentRequests).toEqual([])
    })
})
