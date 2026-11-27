/* oxlint-disable compat/compat */
const mock = vi.hoisted(() => ({
  nativeModule: {} as { gzip?: (payload: string) => Promise<string | null> },
}))

vi.mock('react-native', () => ({
  NativeModules: { PosthogReactNativePlugin: mock.nativeModule },
  NativeEventEmitter: class {},
  Platform: { OS: 'ios', select: (obj: any) => obj.ios ?? obj.default },
}))

import PostHogReactNativePlugin from '../index'

const { nativeModule } = mock

describe('gzip', () => {
  it('resolves to what the native module returns', async () => {
    nativeModule.gzip = vi.fn(() => Promise.resolve('H4sIAAAAAAAAA0sEAEOe0EMBAAAA'))

    await expect(PostHogReactNativePlugin.gzip('a')).resolves.toBe('H4sIAAAAAAAAA0sEAEOe0EMBAAAA')
    expect(nativeModule.gzip).toHaveBeenCalledWith('a')
  })

  it('resolves to null when the native module rejects', async () => {
    nativeModule.gzip = vi.fn(() => Promise.reject(new Error('boom')))

    await expect(PostHogReactNativePlugin.gzip('a')).resolves.toBeNull()
  })

  it('resolves to null when the native build lacks the method', async () => {
    nativeModule.gzip = undefined

    await expect(PostHogReactNativePlugin.gzip('a')).resolves.toBeNull()
  })
})
