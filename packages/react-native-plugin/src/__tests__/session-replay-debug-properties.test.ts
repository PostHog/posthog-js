/* oxlint-disable compat/compat */
const mock = vi.hoisted(() => ({
  nativeModule: {
    getSessionReplayDebugProperties: vi.fn(() => Promise.resolve({ $recording_status: 'active' })),
  },
}))

vi.mock('react-native', () => ({
  NativeModules: { PosthogReactNativePlugin: mock.nativeModule },
  NativeEventEmitter: class {},
  Platform: { OS: 'ios', select: (obj: any) => obj.ios ?? obj.default },
}))

import PostHogReactNativePlugin, { getSessionReplayDebugProperties } from '../index'

const { nativeModule } = mock

describe('getSessionReplayDebugProperties', () => {
  beforeEach(() => {
    nativeModule.getSessionReplayDebugProperties = vi.fn(() => Promise.resolve({ $recording_status: 'active' }))
  })

  it('forwards to the native module and resolves its map', async () => {
    const result = await getSessionReplayDebugProperties()

    expect(nativeModule.getSessionReplayDebugProperties).toHaveBeenCalledWith()
    expect(result).toEqual({ $recording_status: 'active' })
  })

  it('resolves an empty map when the native build lacks the method', async () => {
    ;(nativeModule as any).getSessionReplayDebugProperties = undefined

    await expect(getSessionReplayDebugProperties()).resolves.toEqual({})
  })

  it('the default export exposes it', async () => {
    const result = await PostHogReactNativePlugin.getSessionReplayDebugProperties()

    expect(nativeModule.getSessionReplayDebugProperties).toHaveBeenCalled()
    expect(result).toEqual({ $recording_status: 'active' })
  })
})
