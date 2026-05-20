const deprecationWarning =
  "[PostHog] `posthog-node/experimental` is deprecated. Use `import type { FlagDefinitionCacheData, FlagDefinitionCacheProvider } from 'posthog-node'` instead."

describe('experimental entrypoint', () => {
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    jest.resetModules()
    warnSpy = jest.spyOn(console, 'warn').mockImplementation()
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('warns when runtime importing the deprecated entrypoint', async () => {
    const experimental = await import('../experimental')

    expect(warnSpy).toHaveBeenCalledWith(deprecationWarning)
    expect('FlagDefinitionCacheData' in experimental).toBe(false)
    expect('FlagDefinitionCacheProvider' in experimental).toBe(false)
  })

  it('uses the module cache for repeat imports', async () => {
    await import('../experimental')
    await import('../experimental')

    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})
