/* oxlint-disable compat/compat */
const mock = vi.hoisted(() => ({
  nativeModule: {} as { setSessionReplayMinimumDuration?: (minimumDurationMs: number | null) => Promise<void> },
}))

vi.mock('react-native', () => ({
  NativeModules: { PosthogReactNativePlugin: mock.nativeModule },
  NativeEventEmitter: class {},
  Platform: { OS: 'ios', select: (obj: any) => obj.ios ?? obj.default },
}))

import PostHogReactNativePlugin, { setSessionReplayMinimumDuration } from '../index'

const { nativeModule } = mock

describe('setSessionReplayMinimumDuration', () => {
  it.each([5000, 0, null])('forwards %p to the native module', async (minimumDurationMs) => {
    nativeModule.setSessionReplayMinimumDuration = vi.fn(() => Promise.resolve())

    await setSessionReplayMinimumDuration(minimumDurationMs)

    expect(nativeModule.setSessionReplayMinimumDuration).toHaveBeenCalledWith(minimumDurationMs)
  })

  it('the default export exposes it', async () => {
    nativeModule.setSessionReplayMinimumDuration = vi.fn(() => Promise.resolve())

    await PostHogReactNativePlugin.setSessionReplayMinimumDuration(2000)

    expect(nativeModule.setSessionReplayMinimumDuration).toHaveBeenCalledWith(2000)
  })

  it('resolves when the native build lacks the method', async () => {
    nativeModule.setSessionReplayMinimumDuration = undefined

    await expect(setSessionReplayMinimumDuration(5000)).resolves.toBeUndefined()
  })
})
