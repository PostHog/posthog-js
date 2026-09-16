/* oxlint-disable compat/compat */
const nativeMock = vi.hoisted(() => ({
  persistFatalException: vi.fn(() => Promise.resolve()),
  getPendingFatalExceptions: vi.fn(() =>
    Promise.resolve([{ id: 'journal-1', report: '{"id":"journal-1"}' }])
  ),
  removePendingFatalException: vi.fn(() => Promise.resolve()),
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

describe('fatal journal exports', () => {
  it('exposes persistFatalException as a named export that delegates to the native module', async () => {
    expect(typeof Plugin.persistFatalException).toBe('function')
    await Plugin.persistFatalException('{"id":"a"}')
    expect(nativeMock.persistFatalException).toHaveBeenCalledWith('{"id":"a"}')
  })

  it('exposes getPendingFatalExceptions as a named export that delegates to the native module', async () => {
    expect(typeof Plugin.getPendingFatalExceptions).toBe('function')
    const entries = await Plugin.getPendingFatalExceptions()
    expect(entries).toEqual([{ id: 'journal-1', report: '{"id":"journal-1"}' }])
    expect(nativeMock.getPendingFatalExceptions).toHaveBeenCalled()
  })

  it('exposes removePendingFatalException as a named export that delegates to the native module', async () => {
    expect(typeof Plugin.removePendingFatalException).toBe('function')
    await Plugin.removePendingFatalException('journal-1')
    expect(nativeMock.removePendingFatalException).toHaveBeenCalledWith('journal-1')
  })

  it('exposes the three fatal journal methods on the default export', () => {
    const def = Plugin.default as unknown as {
      persistFatalException?: unknown
      getPendingFatalExceptions?: unknown
      removePendingFatalException?: unknown
    }
    expect(typeof def.persistFatalException).toBe('function')
    expect(typeof def.getPendingFatalExceptions).toBe('function')
    expect(typeof def.removePendingFatalException).toBe('function')
  })
})