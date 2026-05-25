export const wait = async (t: number): Promise<void> => {
  await new Promise<void>((r) => setTimeout(r, t))
}

export const createMockPostHog = (): any => ({
  capture: jest.fn(),
  flush: jest.fn(() => Promise.resolve()),
})

export const createMockLogger = (): any => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    critical: jest.fn(),
    createLogger: jest.fn(() => logger),
  }
  return logger
}

export const waitForExpect = async (timeout: number, fn: () => void): Promise<void> => {
  const start = Date.now()
  while (true) {
    try {
      fn()
      return
    } catch (e) {
      if (Date.now() - start > timeout) {
        throw e
      }
      await wait(10)
    }
  }
}
