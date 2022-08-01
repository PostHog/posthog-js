import { autocapture } from '../autocapture'
import { Decide } from '../decide'
import { _base64Encode } from '../utils'

describe('Decide', () => {
    given('decide', () => new Decide(given.posthog))
    given('posthog', () => ({
        get_config: jest.fn().mockImplementation((key) => given.config[key]),
        capture: jest.fn(),
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
        featureFlags: {
            receivedFeatureFlags: jest.fn(),
        },
        getGroups: () => ({ organization: '5' }),
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
                'https://test.com/decide/?v=2',
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
    })

    describe('parseDecideResponse', () => {
        given('subject', () => () => given.decide.parseDecideResponse(given.decideResponse))

        it('properly parses decide response', () => {
            given('decideResponse', () => ({ enable_collect_everything: true }))
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

        it('Make sure receivedFeatureFlags is not called if the decide response fails', () => {
            given('decideResponse', () => ({ status: 0 }))
            console.error = jest.fn()

            given.subject()

            expect(given.posthog.featureFlags.receivedFeatureFlags).not.toHaveBeenCalled()
            expect(console.error).toHaveBeenCalledWith('Failed to fetch feature flags from PostHog.')
        })
    })
})
