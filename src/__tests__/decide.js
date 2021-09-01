import { autocapture } from '../autocapture'
import { Decide } from '../decide'
import { _ } from '../utils'

describe('Decide', () => {
    given('decide', () => new Decide(given.posthog))
    given('posthog', () => ({
        get_config: jest.fn().mockImplementation((key) => given.config[key]),
        capture: jest.fn(),
        persistence: { register: jest.fn() },
        _captureMetrics: { incr: jest.fn() },
        _addCaptureHook: jest.fn(),
        _prepare_callback: jest.fn().mockImplementation((callback) => callback),
        get_distinct_id: jest.fn().mockImplementation(() => 'distinctid'),
        _send_request: jest
            .fn()
            .mockImplementation((url, params, options, callback) => callback({ config: given.decideResponse })),
        toolbar: {
            maybeLoadEditor: jest.fn(),
            afterDecideResponse: jest.fn(),
        },
        sessionRecording: {
            afterDecideResponse: jest.fn(),
        },
        persistence: { register: jest.fn(), unregister: jest.fn() },
    }))

    given('decideResponse', () => ({ enable_collect_everything: true }))

    given('config', () => ({ api_host: 'https://test.com' }))

    beforeEach(() => {
        jest.spyOn(autocapture, 'afterDecideResponse').mockImplementation()
    })

    describe('constructor', () => {
        given('subject', () => () => given.decide.call())

        given('config', () => ({
            api_host: 'https://test.com',
            token: 'testtoken',
        }))

        it('should call instance._send_request on constructor', () => {
            given.subject()

            expect(given.posthog._send_request).toHaveBeenCalledWith(
                'https://test.com/decide/',
                {
                    data: _.base64Encode(
                        JSON.stringify({
                            token: 'testtoken',
                            distinct_id: 'distinctid',
                        })
                    ),
                },
                { method: 'POST' },
                expect.any(Function)
            )
        })
    })

    describe('parseDecideResponse', () => {
        given('subject', () => () => given.decide.parseDecideResponse(given.decideResponse))

        it('properly parses decide response', () => {
            given('decideResponse', () => ({ enable_collect_everything: true }))
            given.subject()

            expect(given.posthog.sessionRecording.afterDecideResponse).toHaveBeenCalledWith(given.decideResponse)
            expect(given.posthog.toolbar.afterDecideResponse).toHaveBeenCalledWith(given.decideResponse)
            expect(autocapture.afterDecideResponse).toHaveBeenCalledWith(given.decideResponse, given.posthog)
        })

        it('enables compression from decide response', () => {
            given('decideResponse', () => ({ supportedCompression: ['gzip', 'lz64'] }))
            given.subject()

            expect(given.posthog.compression['gzip']).toBe(true)
            expect(given.posthog.compression['lz64']).toBe(true)
        })

        it('enables feature flags from decide response', () => {
            given('decideResponse', () => ({ featureFlags: ['beta-feature', 'alpha-feature-2'] }))
            given.subject()

            expect(given.posthog.persistence.register).toHaveBeenLastCalledWith({
                $active_feature_flags: ['beta-feature', 'alpha-feature-2'],
            })
        })

        it('enables feature flags from decide response (v2 backwards compatibility)', () => {
            // checks that nothing fails when asking for ?v=2 and getting a ?v=1 response
            given('config', () => ({ api_host: 'https://test.com', decide_api_version: 2 }))
            given('decideResponse', () => ({ featureFlags: ['beta-feature', 'alpha-feature-2'] }))
            given.subject()

            expect(given.posthog.persistence.register).toHaveBeenLastCalledWith({
                $active_feature_flags: ['beta-feature', 'alpha-feature-2'],
            })
        })

        it('enables multivariate feature flags from decide v2 response', () => {
            given('config', () => ({ api_host: 'https://test.com', decide_api_version: 2 }))
            given('decideResponse', () => ({
                featureFlags: {
                    'beta-feature': true,
                    'alpha-feature-2': true,
                    'multivariate-flag': 'variant-1',
                },
            }))
            given.subject()

            expect(given.posthog.persistence.register).toHaveBeenLastCalledWith({
                $active_feature_flags: ['beta-feature', 'alpha-feature-2', 'multivariate-flag'],
                $enabled_feature_flags: {
                    'beta-feature': true,
                    'alpha-feature-2': true,
                    'multivariate-flag': 'variant-1',
                },
            })
        })
    })
})
