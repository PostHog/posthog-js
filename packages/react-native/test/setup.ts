const failOnUnexpectedConsoleOutput = (): void => {
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

beforeEach(failOnUnexpectedConsoleOutput)
