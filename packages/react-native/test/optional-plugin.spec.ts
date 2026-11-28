import type { OptionalPluginLoaders } from '../src/optional/OptionalPlugin'

let resolveOptionalPlugin: typeof import('../src/optional/OptionalPlugin').resolveOptionalPlugin

beforeEach(async () => {
  vi.resetModules()
  ;({ resolveOptionalPlugin } = await import('../src/optional/OptionalPlugin'))
})

const PRIMARY = { __plugin: 'primary' }

type LoadedOptionalPlugin = {
  plugin: unknown
  version: string | undefined
}

const optionalLoader =
  <T>(available: boolean, value: T): (() => T) =>
  () => {
    if (!available) {
      throw new Error('not installed')
    }
    return value
  }

const loadOptionalPlugin = (
  os: string,
  {
    primaryInstalled = true,
    primaryMetadataAvailable = true,
    primaryVersion = '3.0.0',
  }: { primaryInstalled?: boolean; primaryMetadataAvailable?: boolean; primaryVersion?: string } = {}
): LoadedOptionalPlugin => {
  const loaders: OptionalPluginLoaders = {
    loadPrimary: optionalLoader(primaryInstalled, PRIMARY) as OptionalPluginLoaders['loadPrimary'],
    loadPrimaryVersion: optionalLoader(primaryMetadataAvailable, primaryVersion),
  }
  return resolveOptionalPlugin(os, loaders)
}

describe('OptionalPlugin loader', () => {
  it('loads the primary plugin on macOS', () => {
    expect(loadOptionalPlugin('macos').plugin).toBe(PRIMARY)
  })

  it('loads the primary plugin on iOS', () => {
    expect(loadOptionalPlugin('ios').plugin).toBe(PRIMARY)
  })

  it('loads the primary plugin version from its exported package metadata', () => {
    expect(loadOptionalPlugin('ios').version).toBe('3.0.0')
  })

  it.each(['2.13.3', '1.6.0'])('ignores plugin %s and warns to upgrade', (primaryVersion) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const loaded = loadOptionalPlugin('ios', { primaryVersion })

    expect(loaded).toEqual({ plugin: undefined, version: undefined })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain(`@posthog/react-native-plugin ${primaryVersion}`)
    expect(warn.mock.calls[0][0]).toContain('3.0.0 or later')
    warn.mockRestore()
  })

  it.each(['3.0.0', '3.0.0-beta.1', '3.2.1', '4.0.0'])('loads plugin %s', (primaryVersion) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(loadOptionalPlugin('ios', { primaryVersion }).plugin).toBe(PRIMARY)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('keeps a plugin whose version cannot be read', () => {
    const loaded = loadOptionalPlugin('ios', { primaryMetadataAvailable: false })

    expect(loaded.plugin).toBe(PRIMARY)
    expect(loaded.version).toBeUndefined()
  })

  it.each(['ios', 'android', 'macos'])('loads no plugin on %s when the plugin is not installed', (os) => {
    expect(loadOptionalPlugin(os, { primaryInstalled: false }).plugin).toBeUndefined()
  })

  it('loads the primary plugin on Android', () => {
    expect(loadOptionalPlugin('android').plugin).toBe(PRIMARY)
  })

  it('loads no native plugin on web', () => {
    expect(loadOptionalPlugin('web').plugin).toBeUndefined()
  })
})
