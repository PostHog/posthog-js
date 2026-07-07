const PRIMARY = { __plugin: 'primary' }
const LEGACY = { __plugin: 'legacy' }

const loadOptionalPlugin = (os: string, { primaryInstalled = true }: { primaryInstalled?: boolean } = {}): unknown => {
  let loaded: unknown
  jest.isolateModules(() => {
    jest.doMock('react-native', () => ({ Platform: { OS: os } }))
    jest.doMock('@posthog/react-native-plugin', () => {
      if (!primaryInstalled) {
        throw new Error('not installed')
      }
      return PRIMARY
    })
    jest.doMock('posthog-react-native-session-replay', () => LEGACY)
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

  it('loads no native plugin on web', () => {
    expect(loadOptionalPlugin('web')).toBeUndefined()
  })
})
