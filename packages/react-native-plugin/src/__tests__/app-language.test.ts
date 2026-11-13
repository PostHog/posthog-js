/* oxlint-disable compat/compat */
const mock = vi.hoisted(() => ({
  nativeModule: {} as { setAppLanguage?: (language: string | null) => Promise<void> },
}))

vi.mock('react-native', () => ({
  NativeModules: { PosthogReactNativePlugin: mock.nativeModule },
  NativeEventEmitter: class {},
  Platform: { OS: 'ios', select: (obj: any) => obj.ios ?? obj.default },
}))

import PostHogReactNativePlugin, { setAppLanguage } from '../index'

const { nativeModule } = mock

describe('setAppLanguage', () => {
  it.each(['de', null])('forwards %p to the native module', async (language) => {
    nativeModule.setAppLanguage = vi.fn(() => Promise.resolve())

    await setAppLanguage(language)

    expect(nativeModule.setAppLanguage).toHaveBeenCalledWith(language)
  })

  it('resolves when the native build lacks the method', async () => {
    nativeModule.setAppLanguage = undefined

    await expect(PostHogReactNativePlugin.setAppLanguage('de')).resolves.toBeUndefined()
  })
})
