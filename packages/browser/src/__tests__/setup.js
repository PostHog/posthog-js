beforeEach(() => {
    // eslint-disable-next-line no-console
    console.error = (...args) => {
        throw new Error(`Unexpected console.error: ${args}`)
    }
    // eslint-disable-next-line no-console
    console.warn = (...args) => {
        throw new Error(`Unexpected console.warn: ${args}`)
    }

    // Prevent jsdom XHR requests from creating open handles (TLSWRAP/Timeout)
    // that keep Jest from exiting. No unit tests need real HTTP responses.
    if (typeof XMLHttpRequest !== 'undefined') {
        jest.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => {})
    }
})
