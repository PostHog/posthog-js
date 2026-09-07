import { resolveOptionalPlugin, type OptionalPluginLoaders } from '../src/optional/OptionalPlugin'

const PRIMARY = { __plugin: 'primary' }
const LEGACY = { __plugin: 'legacy' }

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
    legacyInstalled = true,
  }: { primaryInstalled?: boolean; primaryMetadataAvailable?: boolean; legacyInstalled?: boolean } = {}
): LoadedOptionalPlugin => {
  const loaders: OptionalPluginLoaders = {
    loadPrimary: optionalLoader(primaryInstalled, PRIMARY) as OptionalPluginLoaders['loadPrimary'],
    loadPrimaryVersion: optionalLoader(primaryMetadataAvailable, '2.4.1'),
    loadLegacy: optionalLoader(legacyInstalled, LEGACY) as OptionalPluginLoaders['loadLegacy'],
  }
  return resolveOptionalPlugin(os, loaders)
}

describe('OptionalPlugin loader', () => {
  it('loads the primary plugin on macOS', () => {
    expect(loadOptionalPlugin('macos').plugin).toBe(PRIMARY)
  })

  it('does not fall back to the legacy (session-replay-only) plugin on macOS', () => {
    expect(loadOptionalPlugin('macos', { primaryInstalled: false }).plugin).toBeUndefined()
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

  it('falls back to the legacy plugin on iOS when the primary is not installed', () => {
    expect(loadOptionalPlugin('ios', { primaryInstalled: false }).plugin).toBe(LEGACY)
  })

  it('loads no plugin on iOS when neither the primary nor the legacy plugin is installed', () => {
    expect(loadOptionalPlugin('ios', { primaryInstalled: false, legacyInstalled: false }).plugin).toBeUndefined()
  })

  it('loads the primary plugin on Android', () => {
    expect(loadOptionalPlugin('android').plugin).toBe(PRIMARY)
  })

  it('falls back to the legacy plugin on Android when the primary is not installed', () => {
    expect(loadOptionalPlugin('android', { primaryInstalled: false }).plugin).toBe(LEGACY)
  })

  it('loads no native plugin on web', () => {
    expect(loadOptionalPlugin('web').plugin).toBeUndefined()
  })
})
