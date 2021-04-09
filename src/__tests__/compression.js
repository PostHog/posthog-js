import sinon from 'sinon'
import { autocapture } from '../autocapture'
import { decideCompression, compressData } from '../compression'
import { Decide } from '../decide'

describe('decideCompression()', () => {
    given('subject', () => decideCompression(given.compressionSupport))
    given('compressionSupport', () => ({}))

    it('returns base64 by default', () => {
        expect(given.subject).toEqual('base64')
    })

    it('returns gzip-js if all compressions supported', () => {
        given('compressionSupport', () => ({ lz64: true, 'gzip-js': true }))

        expect(given.subject).toEqual('gzip-js')
    })

    it('returns lz64 if supported', () => {
        given('compressionSupport', () => ({ lz64: true, 'gzip-js': true }))

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

    it('handles lz64', () => {
        given('compression', () => 'lz64')

        expect(given.subject).toMatchSnapshot()
    })

    it('handles gzip-js', () => {
        given('compression', () => 'gzip-js')

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
                    if (url === 'https://test.com/decide/') {
                        callback({ config: { enable_collect_everything: true }, supportedCompression: ['lz64'] })
                    } else {
                        console.log('would be great to get here!')
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

                toolbar: {
                    maybeLoadEditor: jest.fn(),
                    afterDecideResponse: jest.fn(),
                },
                sessionRecording: {
                    afterDecideResponse: jest.fn(),
                },
            }
        })

        afterEach(() => {
            sandbox.restore()
        })

        it('should save supported compression in instance', () => {
            const decide = new Decide(lib)
            decide.call()
            autocapture.init(lib)
            expect(lib.compression).toEqual({ lz64: true })
        })
    })
})
