global.MINIMAL_BUILD = false
global.BUILD_VERSION = '0.0.0'

beforeEach(() => {
    console.error = (...args) => {
        throw new Error(`Unexpected console.error: ${args}`)
    }
    console.warn = (...args) => {
        throw new Error(`Unexpected console.warn: ${args}`)
    }
})
