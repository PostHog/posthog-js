beforeEach(() => {
    console.error = (message) => {
        throw new Error(`Unexpected console.error: ${message}`)
    }
    console.warn = (message) => {
        throw new Error(`Unexpected console.warn: ${message}`)
    }
})
