import { MutableFeatureFlagsConfigSource } from '../feature-flags-config'
import { defaultConfig } from '../posthog-core'
import { PostHogFeatureFlags } from '../posthog-featureflags'
import { createPosthogInstance } from './helpers/posthog-instance'

describe('feature flag evaluation contexts', () => {
    afterEach(() => {
        jest.restoreAllMocks()
    })

    it('includes valid evaluation contexts in Client flags requests', async () => {
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        const client = posthog._getBrowserClientAdapter()
        const sendRequest = jest.spyOn(client, 'sendRequest').mockResolvedValue({ statusCode: 200, json: {} })
        const config = defaultConfig()
        config.evaluation_contexts = ['production', '', 'experiment-A']
        const featureFlags = new PostHogFeatureFlags(new MutableFeatureFlagsConfigSource(config))
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
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        const client = posthog._getBrowserClientAdapter()
        const sendRequest = jest.spyOn(client, 'sendRequest').mockResolvedValue({ statusCode: 200, json: {} })
        const featureFlags = new PostHogFeatureFlags(new MutableFeatureFlagsConfigSource(defaultConfig()))
        featureFlags.setup(client)

        featureFlags._callFlagsEndpoint()

        expect(sendRequest).toHaveBeenCalledWith(
            '/flags/?v=2',
            expect.objectContaining({ body: expect.not.objectContaining({ evaluation_contexts: expect.anything() }) })
        )
        featureFlags.dispose()
    })

    it('maps deprecated evaluation environments and warns once', () => {
        const config = defaultConfig()
        config.evaluation_environments = ['legacy']
        ;(window as Window & { POSTHOG_DEBUG?: boolean }).POSTHOG_DEBUG = true
        const warn = jest.spyOn(window.console, 'warn').mockImplementation()
        const source = new MutableFeatureFlagsConfigSource(config)

        source.update(config, false)

        expect(source.get().evaluationContexts).toEqual(['legacy'])
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn).toHaveBeenCalledWith(
            '[PostHog.js]',
            expect.stringContaining('evaluation_environments is deprecated')
        )
        delete (window as Window & { POSTHOG_DEBUG?: boolean }).POSTHOG_DEBUG
    })
})
