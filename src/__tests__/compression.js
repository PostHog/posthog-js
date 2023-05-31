import sinon from 'sinon'
import { autocapture } from '../autocapture'
import { decideCompression, compressData } from '../compression'
import { Decide } from '../decide'
import { AUTOCAPTURE_DISABLED_SERVER_SIDE } from '../posthog-persistence'

describe('decideCompression()', () => {
    given('subject', () => decideCompression(given.compressionSupport))
    given('compressionSupport', () => ({}))

    it('returns base64 by default', () => {
        expect(given.subject).toEqual('base64')
    })

    it('returns gzip-js if all compressions supported', () => {
        given('compressionSupport', () => ({ 'gzip-js': true }))

        expect(given.subject).toEqual('gzip-js')
    })
})

describe('compressData()', () => {
    given('subject', () => compressData(given.compression, given.jsonData, given.options))

    given('jsonData', () => JSON.stringify({ large_key: new Array(500).join('abc') }))
    given('options', () => ({ method: 'POST' }))

    it('handles base64', () => {
        given('compression', () => 'base64')

        expect(given.subject).toMatchSnapshot()
    })

    it('handles gzip-js', () => {
        given('compression', () => 'gzip-js')

        expect(given.subject).toMatchSnapshot()
    })

    it('handles lz64 as gzip-js', () => {
        given('compression', () => 'lz64')

        expect(given.subject).toMatchSnapshot()
    })
})

describe('Payload Compression', () => {
    afterEach(() => {
        document.getElementsByTagName('html')[0].innerHTML = ''
    })

    describe('compression', () => {
        let lib, sandbox

        beforeEach(() => {
            document.title = 'test page'
            sandbox = sinon.createSandbox()
            autocapture._initializedTokens = []
            lib = {
                debug: true,
                _prepare_callback: sandbox.spy((callback) => callback),
                _send_request: sandbox.spy((url, params, options, callback) => {
                    if (url === 'https://test.com/decide/?v=3') {
                        callback({ config: { enable_collect_everything: true }, supportedCompression: ['gzip-js'] })
                    } else {
                        throw new Error('Should not get here')
                    }
                }),
                get_config: sandbox.spy(function (key) {
                    switch (key) {
                        case 'api_host':
                            return 'https://test.com'
                        case 'token':
                            return 'testtoken'
                    }
                }),
                token: 'testtoken',
                get_distinct_id() {
                    return 'distinctid'
                },
                getGroups: () => ({}),

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
                get_property: (property_key) =>
                    property_key === AUTOCAPTURE_DISABLED_SERVER_SIDE
                        ? given.$autocapture_disabled_server_side
                        : undefined,
            }
        })
        given('$autocapture_disabled_server_side', () => false)

        afterEach(() => {
            sandbox.restore()
        })

        it('should save supported compression in instance', () => {
            new Decide(lib).call()
            autocapture.init(lib)
            expect(lib.compression).toEqual({ 'gzip-js': true })
        })
    })
})
