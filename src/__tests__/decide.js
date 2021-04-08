import { decide } from '../decide'
import { _ } from '../utils'

describe('decide', () => {
    given('decide', () => decide.init(given.posthog))
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
            .mockImplementation((url, params, options, callback) =>
                callback({ config: given.decideResponse }, given.posthog)
            ),
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

    describe('constructor', () => {
        given('subject', () => () => given.decide)

        given('config', () => ({
            api_host: 'https://test.com',
            token: 'testtoken',
        }))

        it('should call instance._send_request on decide.init()', () => {
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
})
