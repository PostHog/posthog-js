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
        ['https://app.posthog.com', 'ui', 'https://app.posthog.com'],
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

    describe('loadScript', () => {
        const theRouter = router()
        const callback = jest.fn()
        beforeEach(() => {
            callback.mockClear()
            document!.getElementsByTagName('html')![0].innerHTML = ''
        })

        it('should insert the given script before the one already on the page', () => {
            document!.body.appendChild(document!.createElement('script'))
            theRouter.loadScript('https://fake_url', callback)
            const scripts = document!.getElementsByTagName('script')
            const new_script = scripts[0]

            expect(scripts.length).toBe(2)
            expect(new_script.type).toBe('text/javascript')
            expect(new_script.src).toBe('https://fake_url/')
            const event = new Event('test')
            new_script.onload!(event)
            expect(callback).toHaveBeenCalledWith(undefined, event)
        })

        it("should add the script to the page when there aren't any preexisting scripts on the page", () => {
            theRouter.loadScript('https://fake_url', callback)
            const scripts = document!.getElementsByTagName('script')

            expect(scripts?.length).toBe(1)
            expect(scripts![0].type).toBe('text/javascript')
            expect(scripts![0].src).toBe('https://fake_url/')
        })

        it('should respond with an error if one happens', () => {
            theRouter.loadScript('https://fake_url', callback)
            const scripts = document!.getElementsByTagName('script')
            const new_script = scripts[0]

            new_script.onerror!('uh-oh')
            expect(callback).toHaveBeenCalledWith('uh-oh')
        })

        it('should prefix with assets url if not already prefixed', () => {
            theRouter.loadScript('/static/recorder.js', callback)
            const scripts = document!.getElementsByTagName('script')
            const new_script = scripts[0]
            expect(new_script.type).toBe('text/javascript')
            expect(new_script.src).toBe('https://us-assets.i.posthog.com/static/recorder.js')
        })
    })
})
