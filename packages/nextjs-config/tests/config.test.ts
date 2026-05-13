/**
 * Tests for withPostHogConfig — focused on the "warn when wrapped" behavior.
 *
 * The bug: when withPostHogConfig is not the outermost wrapper in next.config.js,
 * outer wrappers that spread a function-form config silently drop it. The user
 * sees no source maps and no logs. We add a process.on('exit') warning to make
 * this misconfiguration visible.
 */

jest.mock('@posthog/webpack-plugin', () => ({
  PosthogWebpackPlugin: class {},
  resolveConfig: (cfg: any) => ({
    ...cfg,
    sourcemaps: {
      enabled: cfg?.sourcemaps?.enabled ?? false,
      deleteAfterUpload: cfg?.sourcemaps?.deleteAfterUpload ?? true,
    },
  }),
}))

jest.mock('../src/utils', () => ({
  hasCompilerHook: () => true,
  isTurbopackEnabled: () => false,
  processSourceMaps: async () => {},
}))

describe('withPostHogConfig - misorder detection', () => {
  let exitListeners: Array<() => void>
  let originalProcessOn: typeof process.on
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    jest.resetModules()
    exitListeners = []
    originalProcessOn = process.on.bind(process)
    // Capture 'exit' listeners so we can trigger them deterministically
    // without actually exiting the test process.
    jest.spyOn(process, 'on').mockImplementation(((event: string, listener: () => void) => {
      if (event === 'exit') {
        exitListeners.push(listener)
        return process
      }
      return originalProcessOn(event as any, listener as any)
    }) as any)
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  function loadFreshModule(): { withPostHogConfig: typeof import('../src/config').withPostHogConfig } {
    let mod!: { withPostHogConfig: typeof import('../src/config').withPostHogConfig }
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../src/config')
    })
    return mod
  }

  it('does NOT warn when the returned config function is invoked (correct usage)', async () => {
    const { withPostHogConfig: freshWith } = loadFreshModule()
    const wrapped = freshWith(
      { reactStrictMode: true } as any,
      {
        personalApiKey: 'phx_test',
        envId: 'test-env',
        host: 'https://us.posthog.com',
        sourcemaps: { enabled: true },
      } as any
    )

    // Simulate Next.js calling the function-form config (correct behavior).
    await (wrapped as any)('phase-production-build', { defaultConfig: {} })

    // Trigger captured exit handler(s).
    for (const listener of exitListeners) {
      listener()
    }

    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('inner Next.js config function was never invoked')
    )
  })

  it('warns when the returned config function is never invoked (misordered wrappers)', () => {
    const { withPostHogConfig: freshWith } = loadFreshModule()
    // Simulate an outer wrapper that drops the function, e.g. `{ ...withPostHogConfig(...) }`.
    const wrapped = freshWith(
      { reactStrictMode: true } as any,
      {
        personalApiKey: 'phx_test',
        envId: 'test-env',
        host: 'https://us.posthog.com',
        sourcemaps: { enabled: true },
      } as any
    )
    void wrapped // deliberately never invoked

    for (const listener of exitListeners) {
      listener()
    }

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('inner Next.js config function was never invoked')
    )
  })

  it('does NOT register the exit handler when sourcemaps are disabled', () => {
    const { withPostHogConfig: freshWith } = loadFreshModule()
    freshWith(
      { reactStrictMode: true } as any,
      {
        personalApiKey: 'phx_test',
        envId: 'test-env',
        host: 'https://us.posthog.com',
        sourcemaps: { enabled: false },
      } as any
    )

    expect(exitListeners).toHaveLength(0)
  })
})
