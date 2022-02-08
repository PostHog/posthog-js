import { encodePostData, xhr } from '../send-request'
import { assert, boolean, property, uint8Array, VerbosityLevel } from 'fast-check'

jest.mock('../config', () => ({ DEBUG: false, LIB_VERSION: '1.23.45' }))

describe('xhr', () => {
    given('setRequestHeader', jest.fn)
    given('mockXHR', () => ({
        open: jest.fn(),
        setRequestHeader: given.setRequestHeader,
        onreadystatechange: jest.fn(),
        send: jest.fn(),
        readyState: 4,
        responseText: JSON.stringify('something here'),
        status: 502,
    }))
    given('onXHRError', jest.fn)
    given('xhrParams', () => ({
        url: 'https://any.posthog-instance.com',
        data: '',
        headers: {},
        options: {},
        captureMetrics: {
            incr: () => {},
            decr: () => {},
        },
        callback: () => {},
        retriesPerformedSoFar: null,
        retryQueue: {
            enqueue: () => {},
        },
        onXHRError: given.onXHRError,
    }))
    given('subject', () => () => {
        xhr(given.xhrParams)
        given.mockXHR.onreadystatechange()
    })

    beforeEach(() => {
        window.XMLHttpRequest = jest.fn(() => given.mockXHR)
    })

    describe('when xhr requests fail', () => {
        it('does not error if the configured onXHRError is not a function', () => {
            given('onXHRError', () => 'not a function')
            expect(() => given.subject()).not.toThrow()
        })

        it('calls the injected XHR error handler', () => {
            //cannot use an auto-mock from jest as the code checks if onXHRError is a Function
            let requestFromError
            given('onXHRError', () => (req) => (requestFromError = req))
            given.subject()
            expect(requestFromError).toHaveProperty('status', 502)
        })
    })

    it('adds lib version to request headers', () => {
        given.subject()

        expect(given.setRequestHeader).toHaveBeenCalledWith('user-agent', 'posthog-js/1.23.45')
    })
})

describe('using property based testing to identify edge cases in encodePostData', () => {
    it('can use many combinations of typed arrays and options to detect if the method generates undefined', () => {
        assert(
            property(uint8Array(), boolean(), boolean(), (data, blob, sendBeacon) => {
                const encodedData = encodePostData(data, { blob, sendBeacon, method: 'POST' })
                // returns blob or string - ignore when it is not a string response
                return encodedData.indexOf && encodedData.indexOf('undefined') < 0
            }),
            { numRuns: 1000, verbose: VerbosityLevel.VeryVerbose }
        )
    })

    it('does not return undefined when blob and send beacon are false and the input is an empty uint8array', () => {
        const encodedData = encodePostData(new Uint8Array([]), { method: 'POST' })
        expect(typeof encodedData).toBe('string')
        expect(encodedData).toBe('data=')
    })
})

describe('encodePostData()', () => {
    given('subject', () => encodePostData(given.data, given.options))

    given('data', () => ({ data: 'content' }))
    given('options', () => ({ method: 'POST' }))

    beforeEach(() => {
        jest.spyOn(global, 'Blob').mockImplementation((...args) => ['Blob', ...args])
    })

    it('handles objects', () => {
        expect(given.subject).toMatchSnapshot()
    })

    it('handles arrays', () => {
        given('data', () => ['foo', 'bar'])

        expect(given.subject).toMatchSnapshot()
    })

    it('handles data with compression', () => {
        given('data', () => ({ data: 'content', compression: 'lz64' }))

        expect(given.subject).toMatchSnapshot()
    })

    it('handles GET requests', () => {
        given('options', () => ({ method: 'GET' }))

        expect(given.subject).toEqual(null)
    })

    it('handles blob', () => {
        given('options', () => ({ method: 'POST', blob: true }))
        given('data', () => ({ buffer: 'buffer' }))

        expect(given.subject).toMatchSnapshot()
    })

    it('handles sendBeacon', () => {
        given('options', () => ({ method: 'POST', sendBeacon: true }))

        expect(given.subject).toMatchSnapshot()
    })

    it('handles sendBeacon when data is not a typed array and blob is also true', () => {
        given('options', () => ({ method: 'POST', sendBeacon: true, blob: true }))

        expect(given.subject).toMatchSnapshot()
    })

    it('handles sendBeacon when data is a typed array and blob is also true', () => {
        given('data', () => new Uint8Array([1, 2, 3, 4]))
        given('options', () => ({ method: 'POST', sendBeacon: true, blob: true }))

        expect(given.subject).toMatchSnapshot()
    })
})
