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
    describe('when sentry is available on Window', () => {
        let mockSentry
        beforeEach(() => {
            mockSentry = { captureException: jest.fn() }
            window.Sentry = mockSentry
        })

        describe('when there is an error', () => {
            let xhrMock = generateXmlHttpRequestMock()

            beforeEach(() => {
                window.XMLHttpRequest = jest.fn(() => xhrMock)
            })

            it('does not call Sentry when not on posthog', () => {
                const url = 'https://anything.but.posthog.com'
                const markRequestFailed = jest.fn()
                xhr(generateXhrParams(url, markRequestFailed))
                xhrMock.onreadystatechange()

                expect(mockSentry.captureException).not.toHaveBeenCalled()
                expect(markRequestFailed).toHaveBeenCalled()
            })

            it('does call Sentry when not on posthog', () => {
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
    })
})
