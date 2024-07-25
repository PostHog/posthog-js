import { Decide } from '../decide'
import { PostHogPersistence } from '../posthog-persistence'
import { RequestRouter } from '../utils/request-router'
import { expectScriptToExist, expectScriptToNotExist } from './helpers/script-utils'

const expectDecodedSendRequest = (send_request, data, noCompression, posthog) => {
    const lastCall = send_request.mock.calls[send_request.mock.calls.length - 1]

    const decoded = lastCall[0].data
    // Helper to give us more accurate error messages
    expect(decoded).toEqual(data)

    expect(posthog._send_request).toHaveBeenCalledWith({
        url: 'https://test.com/decide/?v=3',
        data,
        method: 'POST',
        callback: expect.any(Function),
        compression: noCompression ? undefined : 'base64',
        timeout: undefined,
    })
}

describe('Decide', () => {
    let posthog

    given('decide', () => new Decide(posthog))

    given('decideResponse', () => ({}))

    given('config', () => ({ token: 'testtoken', api_host: 'https://test.com', persistence: 'memory' }))

    beforeEach(() => {
        // clean the JSDOM to prevent interdependencies between tests
        document.body.innerHTML = ''
        document.head.innerHTML = ''

        posthog = {
            config: given.config,
            persistence: new PostHogPersistence(given.config),
            register: (props) => posthog.persistence.register(props),
            unregister: (key) => posthog.persistence.unregister(key),
            get_property: (key) => posthog.persistence.props[key],
            capture: jest.fn(),
            _addCaptureHook: jest.fn(),
            _afterDecideResponse: jest.fn(),
            get_distinct_id: jest.fn().mockImplementation(() => 'distinctid'),
            _send_request: jest.fn().mockImplementation(({ callback }) => callback?.({ config: given.decideResponse })),
            featureFlags: {
                receivedFeatureFlags: jest.fn(),
                setReloadingPaused: jest.fn(),
                _startReloadTimer: jest.fn(),
            },
            requestRouter: new RequestRouter({ config: given.config }),
            _hasBootstrappedFeatureFlags: jest.fn(),
            getGroups: () => ({ organization: '5' }),
        }
    })

    describe('constructor', () => {
        given('subject', () => () => given.decide.call())

        given('config', () => ({
            api_host: 'https://test.com',
            token: 'testtoken',
            persistence: 'memory',
        }))

        it('should call instance._send_request on constructor', () => {
            given.subject()

            expectDecodedSendRequest(
                posthog._send_request,
                {
                    token: 'testtoken',
                    distinct_id: 'distinctid',
                    groups: { organization: '5' },
                },
                false,
                posthog
            )
        })

        it('should send all stored properties with decide request', () => {
            posthog.register({
                $stored_person_properties: { key: 'value' },
                $stored_group_properties: { organization: { orgName: 'orgValue' } },
            })
            given.subject()

            expectDecodedSendRequest(
                posthog._send_request,
                {
                    token: 'testtoken',
                    distinct_id: 'distinctid',
                    groups: { organization: '5' },
                    person_properties: { key: 'value' },
                    group_properties: { organization: { orgName: 'orgValue' } },
                },
                false,
                posthog
            )
        })

        it('should send disable flags with decide request when config is set', () => {
            posthog.config = {
                api_host: 'https://test.com',
                token: 'testtoken',
                persistence: 'memory',
                advanced_disable_feature_flags: true,
            }

            posthog.register({
                $stored_person_properties: { key: 'value' },
                $stored_group_properties: { organization: { orgName: 'orgValue' } },
            })
            given.subject()

            expectDecodedSendRequest(
                posthog._send_request,
                {
                    token: 'testtoken',
                    distinct_id: 'distinctid',
                    groups: { organization: '5' },
                    person_properties: { key: 'value' },
                    group_properties: { organization: { orgName: 'orgValue' } },
                    disable_flags: true,
                },
                false,
                posthog
            )
        })

        it('should disable compression when config is set', () => {
            posthog.config = {
                api_host: 'https://test.com',
                token: 'testtoken',
                persistence: 'memory',
                disable_compression: true,
            }

            posthog.register({
                $stored_person_properties: {},
                $stored_group_properties: {},
            })
            given.subject()

            // noCompression is true
            expectDecodedSendRequest(
                posthog._send_request,
                {
                    token: 'testtoken',
                    distinct_id: 'distinctid',
                    groups: { organization: '5' },
                    person_properties: {},
                    group_properties: {},
                },
                true,
                posthog
            )
        })

        it('should send disable flags with decide request when config for advanced_disable_feature_flags_on_first_load is set', () => {
            posthog.config = {
                api_host: 'https://test.com',
                token: 'testtoken',
                persistence: 'memory',
                advanced_disable_feature_flags_on_first_load: true,
            }

            posthog.register({
                $stored_person_properties: { key: 'value' },
                $stored_group_properties: { organization: { orgName: 'orgValue' } },
            })
            given.subject()

            expectDecodedSendRequest(
                posthog._send_request,
                {
                    token: 'testtoken',
                    distinct_id: 'distinctid',
                    groups: { organization: '5' },
                    person_properties: { key: 'value' },
                    group_properties: { organization: { orgName: 'orgValue' } },
                    disable_flags: true,
                },
                false,
                posthog
            )
        })
    })

    describe('parseDecideResponse', () => {
        given('subject', () => () => given.decide.parseDecideResponse(given.decideResponse))

        it('properly parses decide response', () => {
            given('decideResponse', () => ({}))
            given.subject()

            expect(posthog.featureFlags.receivedFeatureFlags).toHaveBeenCalledWith(given.decideResponse, false)
            expect(posthog._afterDecideResponse).toHaveBeenCalledWith(given.decideResponse)
        })

        it('Make sure receivedFeatureFlags is called with errors if the decide response fails', () => {
            given('decideResponse', () => undefined)
            window.POSTHOG_DEBUG = true
            console.error = jest.fn()

            given.subject()

            expect(posthog.featureFlags.receivedFeatureFlags).toHaveBeenCalledWith({}, true)
            expect(console.error).toHaveBeenCalledWith('[PostHog.js]', 'Failed to fetch feature flags from PostHog.')
        })

        it('Make sure receivedFeatureFlags is not called if advanced_disable_feature_flags_on_first_load is set', () => {
            given('decideResponse', () => ({
                featureFlags: { 'test-flag': true },
            }))
            posthog.config = {
                api_host: 'https://test.com',
                token: 'testtoken',
                persistence: 'memory',
                advanced_disable_feature_flags_on_first_load: true,
            }

            given.subject()

            expect(posthog._afterDecideResponse).toHaveBeenCalledWith(given.decideResponse)
            expect(posthog.featureFlags.receivedFeatureFlags).not.toHaveBeenCalled()
        })

        it('Make sure receivedFeatureFlags is not called if advanced_disable_feature_flags is set', () => {
            given('decideResponse', () => ({
                featureFlags: { 'test-flag': true },
            }))
            posthog.config = {
                api_host: 'https://test.com',
                token: 'testtoken',
                persistence: 'memory',
                advanced_disable_feature_flags: true,
            }

            given.subject()

            expect(posthog._afterDecideResponse).toHaveBeenCalledWith(given.decideResponse)
            expect(posthog.featureFlags.receivedFeatureFlags).not.toHaveBeenCalled()
        })

        it('runs site apps if opted in', () => {
            posthog.config = { api_host: 'https://test.com', opt_in_site_apps: true, persistence: 'memory' }
            given('decideResponse', () => ({ siteApps: [{ id: 1, url: '/site_app/1/tokentoken/hash/' }] }))
            given.subject()
            expectScriptToExist('https://test.com/site_app/1/tokentoken/hash/')
        })

        it('does not run site apps code if not opted in', () => {
            window.POSTHOG_DEBUG = true
            given('config', () => ({ api_host: 'https://test.com', opt_in_site_apps: false, persistence: 'memory' }))
            given('decideResponse', () => ({ siteApps: [{ id: 1, url: '/site_app/1/tokentoken/hash/' }] }))
            expect(() => {
                given.subject()
            }).toThrow(
                // throwing only in tests, just an error in production
                'Unexpected console.error: [PostHog.js],PostHog site apps are disabled. Enable the "opt_in_site_apps" config to proceed.'
            )
            expectScriptToNotExist('https://test.com/site_app/1/tokentoken/hash/')
        })
    })
})
