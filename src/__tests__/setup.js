global.BUILD_VERSION = '1.2.3'

beforeEach(() => {
    console.error = (...args) => {
        throw new Error(`Unexpected console.error: ${args}`)
    }
    console.warn = (...args) => {
        throw new Error(`Unexpected console.warn: ${args}`)
    }
})
