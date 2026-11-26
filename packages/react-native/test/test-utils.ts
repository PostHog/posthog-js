export const wait = async (t: number): Promise<void> => {
  await new Promise<void>((r) => setTimeout(r, t))
}

export const createMockPostHog = (): any => ({
  capture: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn(() => Promise.resolve()),
})

export const createMockLogger = (): any => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    critical: vi.fn(),
    createLogger: vi.fn(() => logger),
  }
  return logger
}

// Awaits the serialized native-plugin evaluation chain so tests observe a settled init.
export const waitForNativePluginEvaluation = async (posthog: unknown): Promise<void> => {
  await (posthog as { _sessionReplayEvalChain: Promise<void> })._sessionReplayEvalChain
}

// A first launch holds a manual recording start until a remote config is cached, so a test that
// starts recording right after ready() waits for that first config.
export const waitForRemoteConfig = async (posthog: unknown): Promise<void> => {
  const client = posthog as { getPersistedProperty: (key: string) => unknown }
  await waitForExpect(2000, () => expect(client.getPersistedProperty('remote_config')).toBeTruthy())
}

// Awaits the serialized JS->native command chain (identify, consent, push, and the replay
// debug-property refresh) so tests observe a settled native call, e.g. a refresh landing.
export const waitForNativeChain = async (posthog: unknown): Promise<void> => {
  await (posthog as { _nativeChain: Promise<void> })._nativeChain
}

export const setupFetch = (): void => {
  ;(globalThis as any).window = (globalThis as any).window ?? {}
  ;(globalThis as any).window.fetch = vi.fn(async (url: unknown) => {
    const res = String(url).includes('flags') ? { featureFlags: {} } : { status: 'ok' }
    return {
      status: 200,
      json: () => Promise.resolve(res),
    }
  })
}

// Serves a v1 session replay config on every response, so replay starts once the first remote config lands.
export const setupReplayV1ConfigFetch = (): void => {
  ;(globalThis as any).window = (globalThis as any).window ?? {}
  ;(globalThis as any).window.fetch = vi.fn(async (url: unknown) => {
    const res = String(url).includes('flags')
      ? { featureFlags: {}, sessionRecording: { endpoint: '/s/' } }
      : { status: 'ok', sessionRecording: { endpoint: '/s/' } }
    return { status: 200, json: () => Promise.resolve(res) }
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
