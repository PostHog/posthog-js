import { encodePostData, xhr } from '../send-request'

const generateXmlHttpRequestMock = (status = 502) => ({
    open: jest.fn(),
    setRequestHeader: jest.fn(),
    onreadystatechange: jest.fn(),
    send: jest.fn(),
    readyState: 4,
    responseText: JSON.stringify('something here'),
    status: status,
})

const generateXhrParams = (markRequestFailed, onXHRError = () => {}) => ({
    url: 'https://any.posthog-instance.com',
    data: '',
    headers: {},
    options: {},
    captureMetrics: {
        incr: () => {},
        startRequest: () => {},
        decr: () => {},
        finishRequest: () => {},
        markRequestFailed,
    },
    callback: () => {},
    retriesPerformedSoFar: null,
    retryQueue: {
        enqueue: () => {},
    },
    onXHRError,
})

describe('when xhr requests fail', () => {
    given('mockXHR', generateXmlHttpRequestMock)
    given('markRequestFailed', jest.fn)

    beforeEach(() => {
        window.XMLHttpRequest = jest.fn(() => given.mockXHR)
    })

    it('does not error if the configured onXHRError is not a function', () => {
        const onXHRError = {}
        xhr(generateXhrParams(given.markRequestFailed, onXHRError))

        expect(() => {
            given.mockXHR.onreadystatechange()
        }).not.toThrow()
    })

    it('marks the request as failed', () => {
        xhr(generateXhrParams(given.markRequestFailed))

        given.mockXHR.onreadystatechange()

        expect(given.markRequestFailed).toHaveBeenCalled()
    })

    it('calls the injected XHR error handler', () => {
        //cannot use an auto-mock from jest as the code checks if onXHRError is a Function
        let requestFromError
        const onXHRError = (req) => (requestFromError = req)

        xhr(generateXhrParams(given.markRequestFailed, onXHRError))

        given.mockXHR.onreadystatechange()

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
