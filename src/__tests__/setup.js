global.MINIMAL_BUILD = false

beforeEach(() => {
    console.error = (...args) => {
        throw new Error(`Unexpected console.error: ${args}`)
    }
    console.warn = (...args) => {
        throw new Error(`Unexpected console.warn: ${args}`)
    }
})
