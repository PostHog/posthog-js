const PRIMARY = { __plugin: 'primary' }
const LEGACY = { __plugin: 'legacy' }

const mockOptional = (path: string, installed: boolean, value: unknown): void =>
  jest.doMock(path, () => {
    if (!installed) {
      throw new Error('not installed')
    }
    return value
  })

type LoadedOptionalPlugin = {
  plugin: unknown
  version: string | undefined
}

const loadOptionalPlugin = (
  os: string,
  {
    primaryInstalled = true,
    primaryMetadataAvailable = true,
    legacyInstalled = true,
  }: { primaryInstalled?: boolean; primaryMetadataAvailable?: boolean; legacyInstalled?: boolean } = {}
): LoadedOptionalPlugin => {
  let loaded: LoadedOptionalPlugin = { plugin: undefined, version: undefined }
  jest.isolateModules(() => {
    jest.doMock('react-native', () => ({ Platform: { OS: os } }))
    mockOptional('@posthog/react-native-plugin', primaryInstalled, PRIMARY)
    mockOptional('@posthog/react-native-plugin/package.json', primaryMetadataAvailable, { version: '2.4.1' })
    mockOptional('posthog-react-native-session-replay', legacyInstalled, LEGACY)
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolated require re-runs the module's platform-gated load under a fresh registry
    const optionalPlugin = require('../src/optional/OptionalPlugin')
    loaded = {
      plugin: optionalPlugin.OptionalReactNativePlugin,
      version: optionalPlugin.OptionalReactNativePluginVersion,
    }
  })
  return loaded
}

describe('OptionalPlugin loader', () => {
  afterEach(() => {
    jest.resetModules()
    jest.dontMock('react-native')
    jest.dontMock('@posthog/react-native-plugin')
    jest.dontMock('@posthog/react-native-plugin/package.json')
    jest.dontMock('posthog-react-native-session-replay')
  })

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
