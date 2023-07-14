import { autocapture } from '../autocapture'
import { Decide } from '../decide'
import { _base64Encode } from '../utils'
import { PostHogPersistence } from '../posthog-persistence'

describe('Decide', () => {
    given('decide', () => new Decide(given.posthog))
    given('posthog', () => ({
        get_config: jest.fn().mockImplementation((key) => given.config[key]),
        persistence: new PostHogPersistence(given.config),
        register: (props) => given.posthog.persistence.register(props),
        unregister: (key) => given.posthog.persistence.unregister(key),
        get_property: (key) => given.posthog.persistence.props[key],
        capture: jest.fn(),
        _captureMetrics: { incr: jest.fn() },
        _addCaptureHook: jest.fn(),
        _prepare_callback: jest.fn().mockImplementation((callback) => callback),
        get_distinct_id: jest.fn().mockImplementation(() => 'distinctid'),
        _send_request: jest
            .fn()
            .mockImplementation((url, params, options, callback) => callback({ config: given.decideResponse })),
        toolbar: {
            maybeLoadToolbar: jest.fn(),
            afterDecideResponse: jest.fn(),
        },
        sessionRecording: {
            afterDecideResponse: jest.fn(),
        },
        featureFlags: {
            receivedFeatureFlags: jest.fn(),
        },
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

            expect(given.posthog._send_request).toHaveBeenCalledWith(
                'https://test.com/decide/?v=3',
                {
                    data: _base64Encode(
                        JSON.stringify({
                            token: 'testtoken',
                            distinct_id: 'distinctid',
                            groups: { organization: '5' },
                        })
                    ),
                    verbose: true,
                },
                { method: 'POST' },
                expect.any(Function)
            )
        })

        it('should send all stored properties with decide request', () => {
            given.posthog.register({
                $stored_person_properties: { key: 'value' },
                $stored_group_properties: { organization: { orgName: 'orgValue' } },
            })
            given.subject()

            expect(given.posthog._send_request).toHaveBeenCalledWith(
                'https://test.com/decide/?v=3',
                {
                    data: _base64Encode(
                        JSON.stringify({
                            token: 'testtoken',
                            distinct_id: 'distinctid',
                            groups: { organization: '5' },
                            person_properties: { key: 'value' },
                            group_properties: { organization: { orgName: 'orgValue' } },
                        })
                    ),
                    verbose: true,
                },
                { method: 'POST' },
                expect.any(Function)
            )
        })

        it('should send disable flags with decide request when config is set', () => {
            given.posthog.register({
                $stored_person_properties: { key: 'value' },
                $stored_group_properties: { organization: { orgName: 'orgValue' } },
            })
            given('config', () => ({
                api_host: 'https://test.com',
                token: 'testtoken',
                persistence: 'memory',
                advanced_disable_feature_flags: true,
            }))
            given.subject()

            expect(given.posthog._send_request).toHaveBeenCalledWith(
                'https://test.com/decide/?v=3',
                {
                    data: _base64Encode(
                        JSON.stringify({
                            token: 'testtoken',
                            distinct_id: 'distinctid',
                            groups: { organization: '5' },
                            person_properties: { key: 'value' },
                            group_properties: { organization: { orgName: 'orgValue' } },
                            disable_flags: true,
                        })
                    ),
                    verbose: true,
                },
                { method: 'POST' },
                expect.any(Function)
            )
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
            expect(autocapture.afterDecideResponse).toHaveBeenCalledWith(given.decideResponse, given.posthog)
        })

        it('enables compression from decide response', () => {
            given('decideResponse', () => ({ supportedCompression: ['gzip', 'lz64'] }))
            given.subject()

            expect(given.posthog.compression['gzip']).toBe(true)
            expect(given.posthog.compression['lz64']).toBe(true)
        })

        it('enables compression from decide response when only one received', () => {
            given('decideResponse', () => ({ supportedCompression: ['lz64'] }))
            given.subject()

            expect(given.posthog.compression).not.toHaveProperty('gzip')
            expect(given.posthog.compression['lz64']).toBe(true)
        })

        it('does not enable compression from decide response if compression is disabled', () => {
            given('config', () => ({ disable_compression: true, persistence: 'memory' }))
            given('decideResponse', () => ({ supportedCompression: ['gzip', 'lz64'] }))
            given.subject()

            expect(given.posthog.compression).toEqual({})
        })

        it('Make sure receivedFeatureFlags is not called if the decide response fails', () => {
            given('decideResponse', () => ({ status: 0 }))
            console.error = jest.fn()

            given.subject()

            expect(given.posthog.featureFlags.receivedFeatureFlags).not.toHaveBeenCalled()
            expect(console.error).toHaveBeenCalledWith('Failed to fetch feature flags from PostHog.')
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

        it('runs site apps if opted in', () => {
            given('config', () => ({ api_host: 'https://test.com', opt_in_site_apps: true, persistence: 'memory' }))
            given('decideResponse', () => ({ siteApps: [{ id: 1, url: '/site_app/1/tokentoken/hash/' }] }))
            given.subject()
            const element = window.document.body.children[0]
            expect(element.src).toBe('https://test.com/site_app/1/tokentoken/hash/')
        })

        it('does not run site apps code if not opted in', () => {
            given('config', () => ({ api_host: 'https://test.com', opt_in_site_apps: false, persistence: 'memory' }))
            given('decideResponse', () => ({ siteApps: [{ id: 1, url: '/site_app/1/tokentoken/hash/' }] }))
            expect(() => {
                given.subject()
            }).toThrow(
                // throwing only in tests, just an error in production
                'Unexpected console.error: PostHog site apps are disabled. Enable the "opt_in_site_apps" config to proceed.'
            )
        })
    })
})
