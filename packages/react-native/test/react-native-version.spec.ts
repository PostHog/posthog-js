import { Platform } from 'react-native'
import { minimizeFlagCalledEventProperties } from '@posthog/core'
import { PostHog } from '../src'
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

  it('is sent with every event', async () => {
    platform.constants = { reactNativeVersion: { major: 0, minor: 79, patch: 6 } }
    const posthog = new PostHog('test-token', { flushInterval: 0 })
    await posthog.ready()

    expect(posthog.getCommonEventProperties().$react_native_version).toBe('0.79.6')

    await posthog.shutdown()
  })

  it('survives minimal $feature_flag_called events', () => {
    expect(minimizeFlagCalledEventProperties({ $react_native_version: '0.79.6', custom: 'dropped' })).toEqual({
      $react_native_version: '0.79.6',
    })
  })

  it('is omitted when the platform does not report a version', async () => {
    const posthog = new PostHog('test-token', { flushInterval: 0 })
    await posthog.ready()

    expect(posthog.getCommonEventProperties()).not.toHaveProperty('$react_native_version')

    await posthog.shutdown()
  })
})
