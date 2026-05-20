import {
  getPostHogNodeExperimentalWarningGlobal,
  POSTHOG_NODE_EXPERIMENTAL_DEPRECATION_WARNING,
  POSTHOG_NODE_EXPERIMENTAL_WARNING_KEY,
} from '../experimental-deprecation'

const resetExperimentalWarning = (): void => {
  delete getPostHogNodeExperimentalWarningGlobal()[POSTHOG_NODE_EXPERIMENTAL_WARNING_KEY]
}

describe('experimental entrypoint', () => {
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    jest.resetModules()
    resetExperimentalWarning()
    warnSpy = jest.spyOn(console, 'warn').mockImplementation()
  })

  afterEach(() => {
    warnSpy.mockRestore()
    resetExperimentalWarning()
  })

  it('warns and exposes placeholder named exports for backwards compatibility', async () => {
    const experimental = await import('../experimental')

    expect(warnSpy).toHaveBeenCalledWith(POSTHOG_NODE_EXPERIMENTAL_DEPRECATION_WARNING)
    expect(experimental.FlagDefinitionCacheData).toBeUndefined()
    expect(experimental.FlagDefinitionCacheProvider).toBeUndefined()
  })

  it('only warns once globally', async () => {
    await import('../experimental')
    jest.resetModules()
    await import('../experimental')

    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})
