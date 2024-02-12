import { RequestRouter, RequestRouterTarget } from '../../utils/request-router'

describe('request-router', () => {
    const router = (api_host = 'https://app.posthog.com', ui_host?: string) => {
        return new RequestRouter({
            config: {
                api_host,
                ui_host,
                __preview_ingestion_endpoints: true,
            },
        } as any)
    }

    const testCases: [string, RequestRouterTarget, string][] = [
        // US domain
        ['https://app.posthog.com', 'ui', 'https://app.posthog.com'],
        ['https://app.posthog.com', 'assets', 'https://us-assets.i.posthog.com'],
        ['https://app.posthog.com', 'api', 'https://us-api.i.posthog.com'],
        // US domain via app domain
        ['https://us.posthog.com', 'ui', 'https://us.posthog.com'],
        ['https://us.posthog.com', 'assets', 'https://us-assets.i.posthog.com'],
        ['https://us.posthog.com', 'api', 'https://us-api.i.posthog.com'],

        // EU domain
        ['https://eu.posthog.com', 'ui', 'https://eu.posthog.com'],
        ['https://eu.posthog.com', 'assets', 'https://eu-assets.i.posthog.com'],
        ['https://eu.posthog.com', 'api', 'https://eu-api.i.posthog.com'],

        // custom domain
        ['https://my-custom-domain.com', 'ui', 'https://my-custom-domain.com'],
        ['https://my-custom-domain.com', 'assets', 'https://my-custom-domain.com'],
        ['https://my-custom-domain.com', 'api', 'https://my-custom-domain.com'],
    ]

    it.each(testCases)(
        'should create the appropriate endpoints for host %s and target %s',
        (host, target, expectation) => {
            expect(router(host).endpointFor(target)).toEqual(expectation)
        }
    )

    it('should sanitize the api_host values', () => {
        expect(router('https://app.posthog.com/').endpointFor('api', '/decide?v=3')).toEqual(
            'https://us-api.i.posthog.com/decide?v=3'
        )

        expect(router('https://example.com/').endpointFor('api', '/decide?v=3')).toEqual(
            'https://example.com/decide?v=3'
        )
    })

    it('should use the ui_host if provided', () => {
        expect(router('https://my.domain.com/', 'https://app.posthog.com/').endpointFor('ui')).toEqual(
            'https://app.posthog.com'
        )
    })

    it('should react to config changes', () => {
        const mockPostHog = { config: { api_host: 'https://app.posthog.com', __preview_ingestion_endpoints: true } }

        const router = new RequestRouter(mockPostHog as any)
        expect(router.endpointFor('api')).toEqual('https://us-api.i.posthog.com')

        mockPostHog.config.api_host = 'https://eu.posthog.com'
        expect(router.endpointFor('api')).toEqual('https://eu-c.i.posthog.com')
    })
})
