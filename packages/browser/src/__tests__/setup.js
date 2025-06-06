beforeEach(() => {
    // eslint-disable-next-line no-console
    console.error = (...args) => {
        throw new Error(`Unexpected console.error: ${args}`)
    }
    // eslint-disable-next-line no-console
    console.warn = (...args) => {
        throw new Error(`Unexpected console.warn: ${args}`)
    }
})
