import { autocapture } from '../autocapture'
import { Decide } from '../decide'
import { _base64Encode } from '../utils'
import { PostHogPersistence } from '../posthog-persistence'
import { RequestRouter } from '../utils/request-router'

const expectDecodedSendRequest = (send_request, data) => {
    const lastCall = send_request.mock.calls[send_request.mock.calls.length - 1]

    const decoded = JSON.parse(atob(lastCall[1].data))
    // Helper to give us more accurate error messages
    expect(decoded).toEqual(data)

    expect(given.posthog._send_request).toHaveBeenCalledWith(
        'https://test.com/decide/?v=3',
        {
            data: _base64Encode(JSON.stringify(data)),
            verbose: true,
        },
        { method: 'POST', callback: expect.any(Function), noRetries: true }
    )
}

describe('Decide', () => {
    given('decide', () => new Decide(given.posthog))
    given('posthog', () => ({
        config: given.config,
        persistence: new PostHogPersistence(given.config),
        register: (props) => given.posthog.persistence.register(props),
        unregister: (key) => given.posthog.persistence.unregister(key),
        get_property: (key) => given.posthog.persistence.props[key],
        capture: jest.fn(),
        _addCaptureHook: jest.fn(),
        _afterDecideResponse: jest.fn(),
        _prepare_callback: jest.fn().mockImplementation((callback) => callback),
        get_distinct_id: jest.fn().mockImplementation(() => 'distinctid'),
        _send_request: jest
            .fn()
            .mockImplementation((url, params, { callback }) => callback?.({ config: given.decideResponse })),
        toolbar: {
            maybeLoadToolbar: jest.fn(),
            afterDecideResponse: jest.fn(),
        },
        sessionRecording: {
            afterDecideResponse: jest.fn(),
        },
        featureFlags: {
            receivedFeatureFlags: jest.fn(),
            setReloadingPaused: jest.fn(),
            _startReloadTimer: jest.fn(),
        },
        requestRouter: new RequestRouter({ config: given.config }),
        _hasBootstrappedFeatureFlags: jest.fn(),
        getGroups: () => ({ organization: '5' }),
    }))

    given('decideResponse', () => ({ enable_collect_everything: true }))

    given('config', () => ({ api_host: 'https://test.com', persistence: 'memory' }))

    beforeEach(() => {
        jest.spyOn(autocapture, 'afterDecideResponse').mockImplementation()
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

            expectDecodedSendRequest(given.posthog._send_request, {
                token: 'testtoken',
                distinct_id: 'distinctid',
                groups: { organization: '5' },
            })
        })

        it('should send all stored properties with decide request', () => {
            given.posthog.register({
                $stored_person_properties: { key: 'value' },
                $stored_group_properties: { organization: { orgName: 'orgValue' } },
            })
            given.subject()

            expectDecodedSendRequest(given.posthog._send_request, {
                token: 'testtoken',
                distinct_id: 'distinctid',
                groups: { organization: '5' },
                person_properties: { key: 'value' },
                group_properties: { organization: { orgName: 'orgValue' } },
            })
        })

        it('should send disable flags with decide request when config is set', () => {
            given('config', () => ({
                api_host: 'https://test.com',
                token: 'testtoken',
                persistence: 'memory',
                advanced_disable_feature_flags: true,
            }))
            given.posthog.register({
                $stored_person_properties: { key: 'value' },
                $stored_group_properties: { organization: { orgName: 'orgValue' } },
            })
            given.subject()

            expectDecodedSendRequest(given.posthog._send_request, {
                token: 'testtoken',
                distinct_id: 'distinctid',
                groups: { organization: '5' },
                person_properties: { key: 'value' },
                group_properties: { organization: { orgName: 'orgValue' } },
                disable_flags: true,
            })
        })

        it('should send disable flags with decide request when config for advanced_disable_feature_flags_on_first_load is set', () => {
            given('config', () => ({
                api_host: 'https://test.com',
                token: 'testtoken',
                persistence: 'memory',
                advanced_disable_feature_flags_on_first_load: true,
            }))
            given.posthog.register({
                $stored_person_properties: { key: 'value' },
                $stored_group_properties: { organization: { orgName: 'orgValue' } },
            })
            given.subject()

            expectDecodedSendRequest(given.posthog._send_request, {
                token: 'testtoken',
                distinct_id: 'distinctid',
                groups: { organization: '5' },
                person_properties: { key: 'value' },
                group_properties: { organization: { orgName: 'orgValue' } },
                disable_flags: true,
            })
        })
    })

    describe('parseDecideResponse', () => {
        given('subject', () => () => given.decide.parseDecideResponse(given.decideResponse))

        it('properly parses decide response', () => {
            given('decideResponse', () => ({
                enable_collect_everything: true,
            }))
            given.subject()

            expect(given.posthog.sessionRecording.afterDecideResponse).toHaveBeenCalledWith(given.decideResponse)
            expect(given.posthog.toolbar.afterDecideResponse).toHaveBeenCalledWith(given.decideResponse)
            expect(given.posthog.featureFlags.receivedFeatureFlags).toHaveBeenCalledWith(given.decideResponse)
            expect(given.posthog._afterDecideResponse).toHaveBeenCalledWith(given.decideResponse)
            expect(autocapture.afterDecideResponse).toHaveBeenCalledWith(given.decideResponse, given.posthog)
        })

        it('Make sure receivedFeatureFlags is not called if the decide response fails', () => {
            given('decideResponse', () => ({ status: 0 }))
            window.POSTHOG_DEBUG = true
            console.error = jest.fn()

            given.subject()

            expect(given.posthog.featureFlags.receivedFeatureFlags).not.toHaveBeenCalled()
            expect(console.error).toHaveBeenCalledWith('[PostHog.js]', 'Failed to fetch feature flags from PostHog.')
        })

        it('Make sure receivedFeatureFlags is not called if advanced_disable_feature_flags_on_first_load is set', () => {
            given('decideResponse', () => ({
                enable_collect_everything: true,
                featureFlags: { 'test-flag': true },
            }))
            given('config', () => ({
                api_host: 'https://test.com',
                token: 'testtoken',
                persistence: 'memory',
                advanced_disable_feature_flags_on_first_load: true,
            }))

            given.subject()

            expect(autocapture.afterDecideResponse).toHaveBeenCalledWith(given.decideResponse, given.posthog)
            expect(given.posthog.sessionRecording.afterDecideResponse).toHaveBeenCalledWith(given.decideResponse)
            expect(given.posthog.toolbar.afterDecideResponse).toHaveBeenCalledWith(given.decideResponse)

            expect(given.posthog.featureFlags.receivedFeatureFlags).not.toHaveBeenCalled()
        })

        it('Make sure receivedFeatureFlags is not called if advanced_disable_feature_flags is set', () => {
            given('decideResponse', () => ({
                enable_collect_everything: true,
                featureFlags: { 'test-flag': true },
            }))
            given('config', () => ({
                api_host: 'https://test.com',
                token: 'testtoken',
                persistence: 'memory',
                advanced_disable_feature_flags: true,
            }))

            given.subject()

            expect(autocapture.afterDecideResponse).toHaveBeenCalledWith(given.decideResponse, given.posthog)
            expect(given.posthog.sessionRecording.afterDecideResponse).toHaveBeenCalledWith(given.decideResponse)
            expect(given.posthog.toolbar.afterDecideResponse).toHaveBeenCalledWith(given.decideResponse)

            expect(given.posthog.featureFlags.receivedFeatureFlags).not.toHaveBeenCalled()
        })

        it('runs site apps if opted in', () => {
            given('config', () => ({ api_host: 'https://test.com', opt_in_site_apps: true, persistence: 'memory' }))
            given('decideResponse', () => ({ siteApps: [{ id: 1, url: '/site_app/1/tokentoken/hash/' }] }))
            given.subject()
            const element = window.document.body.children[0]
            expect(element.src).toBe('https://test.com/site_app/1/tokentoken/hash/')
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
        })
    })
})
