/* oxlint-disable compat/compat */
const nativeMock = vi.hoisted(() => ({
  captureFatalException: vi.fn(() => Promise.resolve()),
}))

vi.mock('react-native', () => ({
  NativeModules: { PosthogReactNativePlugin: nativeMock },
  NativeEventEmitter: class {
    addListener() {
      return { remove: () => {} }
    }
  },
  Platform: { OS: 'ios', select: (obj: any) => obj.ios ?? obj.default },
}))

import * as Plugin from '../index'

describe('fatal capture exports', () => {
  it('exposes captureFatalException as a named export that delegates to the native module', async () => {
    expect(typeof Plugin.captureFatalException).toBe('function')
    const properties = { $exception_level: 'fatal', $exception_list: [{ type: 'Error', value: 'boom' }] }
    await Plugin.captureFatalException('user-1', '2026-09-22T10:00:00.000Z', properties)
    expect(nativeMock.captureFatalException).toHaveBeenCalledWith('user-1', '2026-09-22T10:00:00.000Z', properties)
  })

  it('exposes captureFatalException on the default export', () => {
    const def = Plugin.default as unknown as { captureFatalException?: unknown }
    expect(typeof def.captureFatalException).toBe('function')
  })

  it('surfaces a native rejection so the caller knows the capture did not happen', async () => {
    nativeMock.captureFatalException.mockRejectedValueOnce(new Error('native unavailable'))
    await expect(Plugin.captureFatalException('user-1', '2026-09-22T10:00:00.000Z', {})).rejects.toThrow(
      'native unavailable'
    )
  })
})
