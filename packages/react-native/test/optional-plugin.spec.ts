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
  }: { primaryInstalled?: boolean; primaryMetadataAvailable?: boolean } = {}
): LoadedOptionalPlugin => {
  const loaders: OptionalPluginLoaders = {
    loadPrimary: optionalLoader(primaryInstalled, PRIMARY) as OptionalPluginLoaders['loadPrimary'],
    loadPrimaryVersion: optionalLoader(primaryMetadataAvailable, '2.4.1'),
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
    expect(loadOptionalPlugin('ios').version).toBe('2.4.1')
  })

  it('keeps primary plugin versions that predate the package metadata export usable', () => {
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
