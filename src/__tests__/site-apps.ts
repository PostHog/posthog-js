import { SiteApps } from '../site-apps'
import { PostHogPersistence } from '../posthog-persistence'
import { RequestRouter } from '../utils/request-router'
import { expectScriptToExist, expectScriptToNotExist } from './helpers/script-utils'
import { PostHog } from '../posthog-core'
import { DecideResponse, PostHogConfig, Properties } from '../types'
import '../entrypoints/external-scripts-loader'

describe('SiteApps', () => {
    let posthog: PostHog

    const siteApps = () => new SiteApps(posthog)

    const defaultConfig: Partial<PostHogConfig> = {
        token: 'testtoken',
        api_host: 'https://test.com',
        persistence: 'memory',
    }

    beforeEach(() => {
        // clean the JSDOM to prevent interdependencies between tests
        document.body.innerHTML = ''
        document.head.innerHTML = ''
        jest.spyOn(window.console, 'error').mockImplementation()

        posthog = {
            config: defaultConfig,
            persistence: new PostHogPersistence(defaultConfig as PostHogConfig),
            register: (props: Properties) => posthog.persistence!.register(props),
            unregister: (key: string) => posthog.persistence!.unregister(key),
            get_property: (key: string) => posthog.persistence!.props[key],
            capture: jest.fn(),
            _addCaptureHook: jest.fn(),
            _afterDecideResponse: jest.fn(),
            get_distinct_id: jest.fn().mockImplementation(() => 'distinctid'),
            _send_request: jest.fn().mockImplementation(({ callback }) => callback?.({ config: {} })),
            featureFlags: {
                receivedFeatureFlags: jest.fn(),
                setReloadingPaused: jest.fn(),
                _startReloadTimer: jest.fn(),
            },
            requestRouter: new RequestRouter({ config: defaultConfig } as unknown as PostHog),
            _hasBootstrappedFeatureFlags: jest.fn(),
            getGroups: () => ({ organization: '5' }),
        } as unknown as PostHog
    })

    describe('afterDecideResponse', () => {
        const subject = (decideResponse: DecideResponse) => siteApps().afterDecideResponse(decideResponse)

        it('runs site apps if opted in', () => {
            posthog.config = {
                api_host: 'https://test.com',
                opt_in_site_apps: true,
                persistence: 'memory',
            } as PostHogConfig

            subject({ siteApps: [{ id: 1, url: '/site_app/1/tokentoken/hash/' }] } as DecideResponse)

            expectScriptToExist('https://test.com/site_app/1/tokentoken/hash/')
        })

        it('does not run site apps code if not opted in', () => {
            ;(window as any).POSTHOG_DEBUG = true
            // don't technically need to run this but this test assumes opt_in_site_apps is false, let's make that explicit
            posthog.config = {
                api_host: 'https://test.com',
                opt_in_site_apps: false,
                persistence: 'memory',
            } as unknown as PostHogConfig

            subject({ siteApps: [{ id: 1, url: '/site_app/1/tokentoken/hash/' }] } as DecideResponse)

            expect(console.error).toHaveBeenCalledWith(
                '[PostHog.js]',
                'PostHog site apps are disabled. Enable the "opt_in_site_apps" config to proceed.'
            )
            expectScriptToNotExist('https://test.com/site_app/1/tokentoken/hash/')
        })
    })
})
