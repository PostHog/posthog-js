import { AppState, Platform } from 'react-native'
import { getExceptionContext } from '../src/error-tracking/exception-context'

const modules = vi.hoisted(() => ({ updates: undefined as any }))
vi.mock('../src/optional/OptionalExpoUpdates', () => ({
  get OptionalExpoUpdates() {
    return modules.updates
  },
}))

const fail = (): never => {
  throw new Error('Native module unavailable')
}

beforeEach(() => {
  modules.updates = undefined
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

  it.each(['active', 'background', 'inactive', 'extension'] as const)('preserves known app state %s', (appState) => {
    AppState.currentState = appState
    expect(getExceptionContext()).toEqual({ $app_state: appState })
  })

  it.each(['web', 'macos', 'windows'])('captures app state without reading native context on %s', (platform) => {
    Platform.OS = platform as typeof Platform.OS
    const readNative = vi.fn(fail)
    modules.updates = new Proxy({}, { get: readNative })

    for (const appState of ['active', 'background', 'inactive'] as const) {
      AppState.currentState = appState
      expect(getExceptionContext()).toEqual({ $app_state: appState })
    }
    expect(readNative).not.toHaveBeenCalled()
  })

  it.each(['web', 'macos', 'windows'])('omits unknown app state on %s', (platform) => {
    Platform.OS = platform as typeof Platform.OS
    AppState.currentState = 'unknown'
    expect(getExceptionContext()).toEqual({})
  })

  it('includes only allowlisted known OTA values', () => {
    modules.updates = {
      isEnabled: true,
      updateId: 'update-id',
      runtimeVersion: '1.2.3',
      channel: 'production',
      isEmbeddedLaunch: false,
      manifest: { secret: 'do not collect' },
      requestHeaders: { Authorization: 'secret' },
    }
    expect(getExceptionContext()).toEqual({
      $app_state: 'active',
      $expo_update_id: 'update-id',
      $expo_runtime_version: '1.2.3',
      $expo_channel: 'production',
      $expo_is_embedded_launch: false,
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

  it('also reads known values on Android', () => {
    Platform.OS = 'android'
    modules.updates = { isEnabled: true, isEmbeddedLaunch: true }
    expect(getExceptionContext()).toEqual({ $app_state: 'active', $expo_is_embedded_launch: true })
  })

  it('omits unsupported, unknown and incorrectly typed values', () => {
    AppState.currentState = 'unknown'
    modules.updates = { isEnabled: true, updateId: '', runtimeVersion: {}, channel: '  ', isEmbeddedLaunch: 1 }
    expect(getExceptionContext()).toEqual({})
    modules.updates = { isEnabled: true, updateId: 'unknown', channel: null }
    expect(getExceptionContext()).toEqual({})
  })

  it('omits boxed OTA strings', () => {
    modules.updates = {
      isEnabled: true,
      updateId: Object('update-id'),
      runtimeVersion: Object('1.2.3'),
      channel: Object('production'),
    }
    expect(getExceptionContext()).toEqual({ $app_state: 'active' })
  })

  it('reads fresh app state and OTA values rather than caching a snapshot', () => {
    modules.updates = { isEnabled: true, updateId: 'first' }
    expect(getExceptionContext()).toEqual({ $expo_update_id: 'first', $app_state: 'active' })
    modules.updates.updateId = 'second'
    AppState.currentState = 'background'
    expect(getExceptionContext()).toEqual({ $expo_update_id: 'second', $app_state: 'background' })
  })

  it('isolates throwing native getters', () => {
    modules.updates = {
      isEnabled: true,
      get updateId() {
        return fail()
      },
      channel: 'production',
    }
    expect(getExceptionContext()).toEqual({ $app_state: 'active', $expo_channel: 'production' })
    modules.updates = new Proxy({}, { get: fail })
    expect(getExceptionContext()).toEqual({ $app_state: 'active' })
  })

  it('omits unknown initial app state and accepts inactive', () => {
    AppState.currentState = null as any
    expect(getExceptionContext()).toEqual({})
    AppState.currentState = 'inactive'
    expect(getExceptionContext()).toEqual({ $app_state: 'inactive' })
  })
})
