import Config from '../config'

if (process.env.POSTHOG_FUNCTIONAL_TESTS) {
    delete globalThis.fetch
}

const failOnUnexpectedConsoleOutput = () => {
    console.debug = (...args) => {
        throw new Error(`Unexpected console.debug: ${args}`)
    }

    console.error = (...args) => {
        throw new Error(`Unexpected console.error: ${args}`)
    }

    console.info = (...args) => {
        throw new Error(`Unexpected console.info: ${args}`)
    }

    console.log = (...args) => {
        throw new Error(`Unexpected console.log: ${args}`)
    }

    console.warn = (...args) => {
        throw new Error(`Unexpected console.warn: ${args}`)
    }
}

failOnUnexpectedConsoleOutput()

beforeEach(() => {
    Config.DEBUG = false
    if (typeof window !== 'undefined') {
        delete window.POSTHOG_DEBUG
        try {
            window.localStorage?.removeItem('ph_debug')
        } catch {
            // Some storage tests intentionally replace localStorage with a throwing mock.
        }
    }

    failOnUnexpectedConsoleOutput()

    // Prevent jsdom XHR requests from creating open handles (TLSWRAP/Timeout)
    // that keep unit test workers alive. Functional tests exercise the real XHR transport.
    if (!process.env.POSTHOG_FUNCTIONAL_TESTS && typeof XMLHttpRequest !== 'undefined') {
        vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => {})
    }
})
