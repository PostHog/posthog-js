import { encodePostData } from '../send-request'

import { xhr } from '../send-request'

const generateXmlHttpRequestMock = (status = 502) => ({
    open: jest.fn(),
    setRequestHeader: jest.fn(),
    onreadystatechange: jest.fn(),
    send: jest.fn(),
    readyState: 4,
    responseText: JSON.stringify('something here'),
    status: status,
})

const generateXhrParams = (url, markRequestFailed) => ({
    url,
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
})

describe('sending data with xhr', () => {
    let mockSentry
    beforeEach(() => {
        mockSentry = { captureException: jest.fn() }
        window.Sentry = mockSentry
    })

    let xhrMock = generateXmlHttpRequestMock()

    beforeEach(() => {
        window.XMLHttpRequest = jest.fn(() => xhrMock)
    })

    it('does not call Sentry when not on posthog when there is an error', () => {
        const url = 'https://anything.but.posthog.com'
        const markRequestFailed = jest.fn()
        xhr(generateXhrParams(url, markRequestFailed))
        xhrMock.onreadystatechange()

        expect(mockSentry.captureException).not.toHaveBeenCalled()
        expect(markRequestFailed).toHaveBeenCalled()
    })

    it('does call Sentry when not on posthog when there is an error', () => {
        const url = 'https://app.posthog.com'
        const markRequestFailed = jest.fn()
        xhr(generateXhrParams(url, markRequestFailed))
        xhrMock.onreadystatechange()

        expect(mockSentry.captureException).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'ErrorSendingToPostHog',
            })
        )
        expect(markRequestFailed).toHaveBeenCalled()
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
