import sinon from 'sinon'
import { autocapture } from '../autocapture'

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
                        callback({ config: { enable_collect_everything: true }, supportedCompression: ['gzip-js'] })
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
            autocapture.init(lib)
            expect(lib.compression).toEqual({ 'gzip-js': true })
        })
    })
})
