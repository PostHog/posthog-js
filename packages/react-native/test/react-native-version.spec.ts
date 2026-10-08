import { Platform } from 'react-native'
import { PostHog, PostHogCustomStorage } from '../src'
import { getReactNativeVersion } from '../src/utils'

const platform = Platform as typeof Platform & { constants?: unknown }

describe('$react_native_version', () => {
  afterEach(() => {
    delete platform.constants
  })

  it('formats Platform.constants.reactNativeVersion', () => {
    platform.constants = { reactNativeVersion: { major: 0, minor: 79, patch: 6, prerelease: null } }
    expect(getReactNativeVersion()).toBe('0.79.6')
  })

  it('appends the prerelease tag', () => {
    platform.constants = { reactNativeVersion: { major: 0, minor: 80, patch: 0, prerelease: 'rc.2' } }
    expect(getReactNativeVersion()).toBe('0.80.0-rc.2')
  })

  it('is undefined when the platform does not report a version', () => {
    platform.constants = {}
    expect(getReactNativeVersion()).toBeUndefined()
  })

  it('is undefined when the version object has no numeric fields', () => {
    platform.constants = { reactNativeVersion: {} }
    expect(getReactNativeVersion()).toBeUndefined()
  })

  it('is undefined when reading the constants throws', () => {
    Object.defineProperty(platform, 'constants', {
      configurable: true,
      get: () => {
        throw new Error('getConstants failed')
      },
    })
    expect(getReactNativeVersion()).toBeUndefined()
  })

  it('is not sent with every event', async () => {
    platform.constants = { reactNativeVersion: { major: 0, minor: 79, patch: 6 } }
    const posthog = new PostHog('test-token', { flushInterval: 0 })
    await posthog.ready()

    expect(posthog.getCommonEventProperties()).not.toHaveProperty('$react_native_version')

    await posthog.shutdown()
  })

  it('is sent on Application Installed and Application Updated only', async () => {
    platform.constants = { reactNativeVersion: { major: 0, minor: 79, patch: 6 } }
    const cache: Record<string, string> = {}
    const customStorage: PostHogCustomStorage = {
      getItem: async (key) => cache[key] ?? null,
      setItem: async (key, value) => {
        cache[key] = value
      },
    }
    const start = async (appBuild: string): Promise<Record<string, any>> => {
      const events: Record<string, any> = {}
      const posthog = new PostHog('test-token', {
        flushInterval: 0,
        customStorage,
        captureAppLifecycleEvents: true,
        customAppProperties: { $app_build: appBuild, $app_version: appBuild },
      })
      posthog.on('capture', (e: { event: string; properties: Record<string, any> }) => {
        events[e.event] = e.properties
      })
      await vi.waitFor(() => expect(events).toHaveProperty(['Application Opened']))
      await posthog.shutdown()
      return events
    }

    const install = await start('1')
    expect(install['Application Installed'].$react_native_version).toBe('0.79.6')
    expect(install['Application Opened']).not.toHaveProperty('$react_native_version')

    const update = await start('2')
    expect(update['Application Updated'].$react_native_version).toBe('0.79.6')
    expect(update['Application Opened']).not.toHaveProperty('$react_native_version')
  })
})
