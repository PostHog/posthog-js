import { RequestRouter, RequestRouterTarget } from '../../utils/request-router'

describe('request-router', () => {
    const router = (
        apiHost = 'https://app.posthog.com',
        uiHost?: string,
        configOverrides: Record<string, unknown> = {}
    ) => {
        return new RequestRouter({
            config: {
                apiHost,
                uiHost,
                ...configOverrides,
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
    ])('should sanitize the apiHost values for "%s"', (apiHost, expected) => {
        expect(router(apiHost).endpointFor('api', '/flags?v=2&config=true')).toEqual(`${expected}flags?v=2&config=true`)
    })

    it('should use the uiHost if provided', () => {
        expect(router('https://my.domain.com/', 'https://eu.posthog.com/').endpointFor('ui')).toEqual(
            'https://eu.posthog.com'
        )

        expect(router('https://my.domain.com/', 'https://app.posthog.com/').endpointFor('ui')).toEqual(
            'https://us.posthog.com'
        )
    })

    it('should react to config changes', () => {
        const mockPostHog = { config: { apiHost: 'https://app.posthog.com' } }

        const router = new RequestRouter(mockPostHog as any)
        expect(router.endpointFor('api')).toEqual('https://us.i.posthog.com')

        mockPostHog.config.apiHost = 'https://eu.posthog.com'
        expect(router.endpointFor('api')).toEqual('https://eu.i.posthog.com')
    })

    describe('assetHost configuration', () => {
        it.each([
            [
                'keeps exact semver asset paths on the normal US asset host when assetHost is not configured',
                'https://app.posthog.com',
                undefined,
                '/static/1.370.0/recorder.js',
                'https://us-assets.i.posthog.com/static/1.370.0/recorder.js',
            ],
            [
                'keeps exact semver asset paths on the normal EU asset host when assetHost is not configured',
                'https://eu.posthog.com',
                undefined,
                '/static/1.370.0/recorder.js',
                'https://eu-assets.i.posthog.com/static/1.370.0/recorder.js',
            ],
            [
                'accepts assetHost for exact semver asset paths',
                'https://app.posthog.com',
                'https://cdn-preview.example.com/',
                '/static/1.370.0/recorder.js',
                'https://cdn-preview.example.com/static/1.370.0/recorder.js',
            ],
            [
                'accepts assetHost for compatibility asset paths',
                'https://app.posthog.com',
                'https://cdn-preview.example.com/',
                '/static/recorder.js?v=1.370.0',
                'https://cdn-preview.example.com/static/recorder.js?v=1.370.0',
            ],
            [
                'lets assetHost win even when apiHost is custom',
                'https://my-proxy.example.com',
                'https://cdn-preview.example.com',
                '/static/1.370.0/recorder.js',
                'https://cdn-preview.example.com/static/1.370.0/recorder.js',
            ],
            [
                'keeps custom asset hosts unchanged when assetHost is not configured',
                'https://my-proxy.example.com',
                undefined,
                '/static/1.370.0/recorder.js',
                'https://my-proxy.example.com/static/1.370.0/recorder.js',
            ],
        ])('%s', (_, apiHost, assetHost, path, expected) => {
            expect(
                router(apiHost, undefined, {
                    assetHost: assetHost,
                }).endpointFor('assets', path)
            ).toEqual(expected)
        })

        it('keeps non-static asset paths on the normal asset host even when assetHost is configured', () => {
            const assetHostRouter = router('https://app.posthog.com', undefined, {
                assetHost: 'https://cdn-preview.example.com/',
            })

            expect(assetHostRouter.endpointFor('assets', '/array/test-token/config.js')).toEqual(
                'https://us-assets.i.posthog.com/array/test-token/config.js'
            )
        })
    })

    describe('flagsApiHost configuration', () => {
        it('should use flagsApiHost when set', () => {
            const mockPostHog = {
                config: {
                    apiHost: 'https://app.posthog.com',
                    flagsApiHost: 'https://example.com/feature-flags',
                },
            }
            const router = new RequestRouter(mockPostHog as any)

            expect(router.endpointFor('flags', '/flags/?v=2')).toEqual('https://example.com/feature-flags/flags/?v=2')
        })

        it('should fall back to apiHost when flagsApiHost is not set', () => {
            const mockPostHog = {
                config: {
                    apiHost: 'https://app.posthog.com',
                },
            }
            const router = new RequestRouter(mockPostHog as any)

            expect(router.endpointFor('flags', '/flags/?v=2')).toEqual('https://us.i.posthog.com/flags/?v=2')
        })

        it('should trim trailing slashes from flagsApiHost', () => {
            const mockPostHog = {
                config: {
                    apiHost: 'https://app.posthog.com',
                    flagsApiHost: 'https://flags.example.com/',
                },
            }
            const router = new RequestRouter(mockPostHog as any)

            expect(router.endpointFor('flags', '/flags/?v=2')).toEqual('https://flags.example.com/flags/?v=2')
        })

        it('should react to flagsApiHost config changes', () => {
            const mockPostHog = {
                config: {
                    apiHost: 'https://app.posthog.com',
                    flagsApiHost: 'https://flags1.example.com',
                },
            }
            const router = new RequestRouter(mockPostHog as any)

            expect(router.endpointFor('flags', '/flags/?v=2')).toEqual('https://flags1.example.com/flags/?v=2')

            mockPostHog.config.flagsApiHost = 'https://flags2.example.com'
            expect(router.endpointFor('flags', '/flags/?v=2')).toEqual('https://flags2.example.com/flags/?v=2')
        })

        it('should use flagsApiHost even when apiHost is a custom domain', () => {
            const mockPostHog = {
                config: {
                    apiHost: 'https://my-proxy.com',
                    flagsApiHost: 'https://flags.example.com',
                },
            }
            const router = new RequestRouter(mockPostHog as any)

            expect(router.endpointFor('flags', '/flags/?v=2')).toEqual('https://flags.example.com/flags/?v=2')
        })
    })
})
