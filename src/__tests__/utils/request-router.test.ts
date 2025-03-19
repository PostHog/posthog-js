import { RequestRouter, RequestRouterTarget } from '../../utils/request-router'

describe('request-router', () => {
    const router = (api_host = 'https://app.posthog.com', ui_host?: string) => {
        return new RequestRouter({
            config: {
                api_host,
                ui_host,
            },
        } as any)
    }

    const testCases: [string, RequestRouterTarget, string][] = [
        // US domain
        ['https://app.posthog.com', 'ui', 'https://us.posthog.com'],
        ['https://app.posthog.com', 'assets', 'https://us-assets.i.posthog.com'],
        ['https://app.posthog.com', 'api', 'https://us.i.posthog.com'],
        // US domain via app domain
        ['https://us.posthog.com', 'ui', 'https://us.posthog.com'],
        ['https://us.posthog.com', 'assets', 'https://us-assets.i.posthog.com'],
        ['https://us.posthog.com', 'api', 'https://us.i.posthog.com'],
        ['https://us.i.posthog.com', 'api', 'https://us.i.posthog.com'],
        ['https://us.i.posthog.com', 'assets', 'https://us-assets.i.posthog.com'],
        ['https://us-assets.i.posthog.com', 'assets', 'https://us-assets.i.posthog.com'],
        ['https://us-assets.i.posthog.com', 'api', 'https://us.i.posthog.com'],

        // EU domain
        ['https://eu.posthog.com', 'ui', 'https://eu.posthog.com'],
        ['https://eu.i.posthog.com', 'ui', 'https://eu.posthog.com'],
        ['https://eu.posthog.com', 'assets', 'https://eu-assets.i.posthog.com'],
        ['https://eu.posthog.com', 'api', 'https://eu.i.posthog.com'],
        ['https://eu.i.posthog.com', 'api', 'https://eu.i.posthog.com'],
        ['https://eu.i.posthog.com', 'assets', 'https://eu-assets.i.posthog.com'],
        ['https://eu-assets.i.posthog.com', 'assets', 'https://eu-assets.i.posthog.com'],
        ['https://eu-assets.i.posthog.com', 'api', 'https://eu.i.posthog.com'],

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

    it.each([
        ['https://app.posthog.com/', 'https://us.i.posthog.com/'],
        // adds trailing slash
        ['https://app.posthog.com', 'https://us.i.posthog.com/'],
        // accepts the empty string
        ['', '/'],
        // ignores whitespace string
        ['     ', '/'],
        ['  https://app.posthog.com       ', 'https://us.i.posthog.com/'],
        ['https://example.com/', 'https://example.com/'],
    ])('should sanitize the api_host values for "%s"', (apiHost, expected) => {
        expect(router(apiHost).endpointFor('api', '/decide?v=3')).toEqual(`${expected}decide?v=3`)
    })

    it('should use the ui_host if provided', () => {
        expect(router('https://my.domain.com/', 'https://eu.posthog.com/').endpointFor('ui')).toEqual(
            'https://eu.posthog.com'
        )

        expect(router('https://my.domain.com/', 'https://app.posthog.com/').endpointFor('ui')).toEqual(
            'https://us.posthog.com'
        )
    })

    it('should react to config changes', () => {
        const mockPostHog = { config: { api_host: 'https://app.posthog.com' } }

        const router = new RequestRouter(mockPostHog as any)
        expect(router.endpointFor('api')).toEqual('https://us.i.posthog.com')

        mockPostHog.config.api_host = 'https://eu.posthog.com'
        expect(router.endpointFor('api')).toEqual('https://eu.i.posthog.com')
    })
})
