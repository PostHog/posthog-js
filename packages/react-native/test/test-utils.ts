export const wait = async (t: number): Promise<void> => {
  await new Promise<void>((r) => setTimeout(r, t))
}

export const createMockPostHog = (): any => ({
  capture: jest.fn(),
  captureException: jest.fn(),
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

// Awaits the serialized native-plugin evaluation chain so tests observe a settled init.
export const waitForNativePluginEvaluation = async (posthog: unknown): Promise<void> => {
  await (posthog as { _sessionReplayEvalChain: Promise<void> })._sessionReplayEvalChain
}

export const setupFetch = (): void => {
  ;(globalThis as any).window = (globalThis as any).window ?? {}
  ;(globalThis as any).window.fetch = jest.fn(async (url: unknown) => {
    const res = String(url).includes('flags') ? { featureFlags: {} } : { status: 'ok' }
    return {
      status: 200,
      json: () => Promise.resolve(res),
    }
  })
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
