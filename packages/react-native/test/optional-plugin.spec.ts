const PRIMARY = { __plugin: 'primary' }
const LEGACY = { __plugin: 'legacy' }

const mockOptional = (path: string, installed: boolean, value: unknown): void =>
  jest.doMock(path, () => {
    if (!installed) {
      throw new Error('not installed')
    }
    return value
  })

const loadOptionalPlugin = (
  os: string,
  { primaryInstalled = true, legacyInstalled = true }: { primaryInstalled?: boolean; legacyInstalled?: boolean } = {}
): unknown => {
  let loaded: unknown
  jest.isolateModules(() => {
    jest.doMock('react-native', () => ({ Platform: { OS: os } }))
    mockOptional('@posthog/react-native-plugin', primaryInstalled, PRIMARY)
    mockOptional('posthog-react-native-session-replay', legacyInstalled, LEGACY)
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolated require re-runs the module's platform-gated load under a fresh registry
    loaded = require('../src/optional/OptionalPlugin').OptionalReactNativePlugin
  })
  return loaded
}

describe('OptionalPlugin loader', () => {
  afterEach(() => {
    jest.resetModules()
    jest.dontMock('react-native')
    jest.dontMock('@posthog/react-native-plugin')
    jest.dontMock('posthog-react-native-session-replay')
  })

  it('loads the primary plugin on macOS', () => {
    expect(loadOptionalPlugin('macos')).toBe(PRIMARY)
  })

  it('does not fall back to the legacy (session-replay-only) plugin on macOS', () => {
    expect(loadOptionalPlugin('macos', { primaryInstalled: false })).toBeUndefined()
  })

  it('loads the primary plugin on iOS', () => {
    expect(loadOptionalPlugin('ios')).toBe(PRIMARY)
  })

  it('falls back to the legacy plugin on iOS when the primary is not installed', () => {
    expect(loadOptionalPlugin('ios', { primaryInstalled: false })).toBe(LEGACY)
  })

  it('loads no plugin on iOS when neither the primary nor the legacy plugin is installed', () => {
    expect(loadOptionalPlugin('ios', { primaryInstalled: false, legacyInstalled: false })).toBeUndefined()
  })

  it('loads the primary plugin on Android', () => {
    expect(loadOptionalPlugin('android')).toBe(PRIMARY)
  })

  it('falls back to the legacy plugin on Android when the primary is not installed', () => {
    expect(loadOptionalPlugin('android', { primaryInstalled: false })).toBe(LEGACY)
  })

  it('loads no native plugin on web', () => {
    expect(loadOptionalPlugin('web')).toBeUndefined()
  })
})
