import Config from '../config'

// Vitest has no Jest-style per-callback module sandbox. Resetting the Vite module cache
// before and after the callback preserves the isolation these legacy tests require.
vi.isolateModules = (callback) => {
    vi.resetModules()
    try {
        return callback()
    } finally {
        vi.resetModules()
    }
}
vi.isolateModulesAsync = async (callback) => {
    vi.resetModules()
    try {
        return await callback()
    } finally {
        vi.resetModules()
    }
}
vi.dontMock = vi.unmock
vi.retryTimes = (retry) => vi.setConfig({ retry })

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
    // that keep Jest from exiting. No unit tests need real HTTP responses.
    if (typeof XMLHttpRequest !== 'undefined') {
        vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => {})
    }
})
