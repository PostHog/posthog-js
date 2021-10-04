import { encodePostData, xhr } from '../send-request'

describe('when xhr requests fail', () => {
    given('mockXHR', () => ({
        open: jest.fn(),
        setRequestHeader: jest.fn(),
        onreadystatechange: jest.fn(),
        send: jest.fn(),
        readyState: 4,
        responseText: JSON.stringify('something here'),
        status: 502,
    }))
    given('markRequestFailed', jest.fn)
    given('onXHRError', jest.fn)
    given('xhrParams', () => ({
        url: 'https://any.posthog-instance.com',
        data: '',
        headers: {},
        options: {},
        captureMetrics: {
            incr: () => {},
            startRequest: () => {},
            decr: () => {},
            finishRequest: () => {},
            markRequestFailed: given.markRequestFailed,
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

    it('does not error if the configured onXHRError is not a function', () => {
        given('onXHRError', () => 'not a function')
        expect(() => given.subject()).not.toThrow()
    })

    it('marks the request as failed', () => {
        given('onXHRError', () => undefined)
        given.subject()
        expect(given.markRequestFailed).toHaveBeenCalled()
    })

    it('calls the injected XHR error handler', () => {
        //cannot use an auto-mock from jest as the code checks if onXHRError is a Function
        let requestFromError
        given('onXHRError', () => (req) => (requestFromError = req))
        given.subject()
        expect(requestFromError).toHaveProperty('status', 502)
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
})
