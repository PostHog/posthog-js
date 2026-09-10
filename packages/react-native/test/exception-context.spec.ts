import { AppState, Platform } from 'react-native'
import { getExceptionContext } from '../src/error-tracking/exception-context'

const modules = vi.hoisted(() => ({ updates: undefined as any, deviceInfo: undefined as any }))
vi.mock('../src/optional/OptionalExpoUpdates', () => ({
  get OptionalExpoUpdates() {
    return modules.updates
  },
}))
vi.mock('../src/optional/OptionalReactNativeDeviceInfo', () => ({
  get OptionalReactNativeDeviceInfo() {
    return modules.deviceInfo
  },
}))

const fail = (): never => {
  throw new Error('Native module unavailable')
}

beforeEach(() => {
  modules.updates = undefined
  modules.deviceInfo = undefined
  Platform.OS = 'ios'
  AppState.currentState = 'active'
})

afterEach(() => {
  Platform.OS = 'ios'
  AppState.currentState = 'active'
  vi.unstubAllGlobals()
})

describe('getExceptionContext', () => {
  it('works without optional modules, including the first app state', () => {
    expect(getExceptionContext()).toEqual({ $app_state: 'active' })
  })

  it.each(['web', 'macos', 'windows'])('does not read native context on %s', (platform) => {
    Platform.OS = platform as typeof Platform.OS
    modules.updates = new Proxy({}, { get: fail })
    modules.deviceInfo = new Proxy({}, { get: fail })
    expect(getExceptionContext()).toEqual({})
  })

  it('includes only allowlisted known OTA and power values', () => {
    modules.updates = {
      isEnabled: true,
      updateId: 'update-id',
      runtimeVersion: '1.2.3',
      channel: 'production',
      isEmbeddedLaunch: false,
      manifest: { secret: 'do not collect' },
      requestHeaders: { Authorization: 'secret' },
    }
    modules.deviceInfo = {
      getPowerStateSync: () => ({ batteryLevel: 0, batteryState: 'unplugged', lowPowerMode: false }),
    }
    expect(getExceptionContext()).toEqual({
      $app_state: 'active',
      $expo_update_id: 'update-id',
      $expo_runtime_version: '1.2.3',
      $expo_channel: 'production',
      $expo_is_embedded_launch: false,
      $battery_level: 0,
      $battery_charging: false,
      $low_power_mode: false,
    })
  })

  it.each([false, undefined, null, 'true'])('omits OTA when isEnabled is %s', (isEnabled) => {
    modules.updates = { isEnabled, updateId: 'dev-id', runtimeVersion: 'dev', isEmbeddedLaunch: false }
    expect(getExceptionContext()).toEqual({ $app_state: 'active' })
  })

  it('omits OTA in development even if an optional module reports enabled', () => {
    vi.stubGlobal('__DEV__', true)
    modules.updates = { isEnabled: true, updateId: 'dev-id' }
    expect(getExceptionContext()).toEqual({ $app_state: 'active' })
  })

  it.each([null, undefined, {}])('tolerates an unavailable power snapshot %s', (power) => {
    modules.deviceInfo = { getPowerStateSync: () => power }
    expect(getExceptionContext()).toEqual({ $app_state: 'active' })
  })

  it('also reads known values on Android', () => {
    Platform.OS = 'android'
    modules.updates = { isEnabled: true, isEmbeddedLaunch: true }
    modules.deviceInfo = { getPowerStateSync: () => ({ batteryState: 'unplugged' }) }
    expect(getExceptionContext()).toEqual({
      $app_state: 'active',
      $expo_is_embedded_launch: true,
      $battery_charging: false,
    })
  })

  it('omits unsupported, unknown and incorrectly typed values', () => {
    AppState.currentState = 'unknown'
    modules.updates = { isEnabled: true, updateId: '', runtimeVersion: {}, channel: '  ', isEmbeddedLaunch: 1 }
    modules.deviceInfo = {
      getPowerStateSync: () => ({ batteryLevel: -1, batteryState: 'unknown', lowPowerMode: 'false' }),
    }
    expect(getExceptionContext()).toEqual({})
    modules.updates = { isEnabled: true, updateId: 'unknown', channel: null }
    modules.deviceInfo = {}
    expect(getExceptionContext()).toEqual({})
  })

  it.each([-1, 1.1, NaN, Infinity, '0.5', null, undefined])('omits invalid battery level %s', (batteryLevel) => {
    modules.deviceInfo = { getPowerStateSync: () => ({ batteryLevel }) }
    expect(getExceptionContext()).toEqual({ $app_state: 'active' })
  })

  it.each(['charging', 'full'])('reports %s as charging', (batteryState) => {
    modules.deviceInfo = { getPowerStateSync: () => ({ batteryState, batteryLevel: 1, lowPowerMode: true }) }
    expect(getExceptionContext()).toMatchObject({ $battery_charging: true, $battery_level: 1, $low_power_mode: true })
  })

  it('reads fresh conditions and OTA values rather than caching a snapshot', () => {
    const power = { batteryLevel: 0.5 }
    modules.deviceInfo = { getPowerStateSync: () => power }
    modules.updates = { isEnabled: true, updateId: 'first' }
    expect(getExceptionContext()).toMatchObject({ $battery_level: 0.5, $expo_update_id: 'first', $app_state: 'active' })
    power.batteryLevel = 0.25
    modules.updates.updateId = 'second'
    AppState.currentState = 'background'
    expect(getExceptionContext()).toMatchObject({
      $battery_level: 0.25,
      $expo_update_id: 'second',
      $app_state: 'background',
    })
  })

  it('isolates throwing getters and native methods', () => {
    modules.updates = {
      isEnabled: true,
      get updateId() {
        return fail()
      },
      channel: 'production',
    }
    modules.deviceInfo = { getPowerStateSync: fail }
    expect(getExceptionContext()).toEqual({ $app_state: 'active', $expo_channel: 'production' })
    modules.updates = new Proxy({}, { get: fail })
    modules.deviceInfo = {
      getPowerStateSync: () => ({
        batteryLevel: 0.5,
        get batteryState() {
          return fail()
        },
        lowPowerMode: true,
      }),
    }
    expect(getExceptionContext()).toEqual({ $app_state: 'active', $battery_level: 0.5, $low_power_mode: true })
    modules.deviceInfo = new Proxy({}, { get: fail })
    expect(getExceptionContext()).toEqual({ $app_state: 'active' })
  })

  it('omits unknown initial app state and accepts inactive', () => {
    AppState.currentState = null as any
    expect(getExceptionContext()).toEqual({})
    AppState.currentState = 'inactive'
    expect(getExceptionContext()).toEqual({ $app_state: 'inactive' })
  })
})
