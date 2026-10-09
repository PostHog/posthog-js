// @vitest-environment jsdom
import { PostHogFeatureFlags } from '../src/feature-flags'
import { createConfig, createFlagsClient } from './helpers/feature-flags'

describe('feature flag evaluation contexts', () => {
    afterEach(() => vi.restoreAllMocks())
    it('includes valid evaluation contexts in Client flags requests', async () => {
        const client = createFlagsClient()
        const sendRequest = vi.spyOn(client, 'sendRequest').mockResolvedValue({ statusCode: 200, json: {} })
        const config = createConfig()
        config.evaluationContexts = ['production', '', 'experiment-A']
        const featureFlags = new PostHogFeatureFlags({ get: () => config })
        featureFlags.setup(client)

        featureFlags._callFlagsEndpoint()

        expect(sendRequest).toHaveBeenCalledWith(
            '/flags/?v=2',
            expect.objectContaining({
                target: 'flags',
                body: expect.objectContaining({ evaluation_contexts: ['production', 'experiment-A'] }),
            })
        )
        featureFlags.dispose()
    })

    it('omits evaluation contexts when none are configured', async () => {
        const client = createFlagsClient()
        const sendRequest = vi.spyOn(client, 'sendRequest').mockResolvedValue({ statusCode: 200, json: {} })
        const featureFlags = new PostHogFeatureFlags({ get: () => createConfig() })
        featureFlags.setup(client)

        featureFlags._callFlagsEndpoint()

        expect(sendRequest).toHaveBeenCalledWith(
            '/flags/?v=2',
            expect.objectContaining({ body: expect.not.objectContaining({ evaluation_contexts: expect.anything() }) })
        )
        featureFlags.dispose()
    })
})
