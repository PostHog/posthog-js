import { StyleSheet } from 'react-native'

import { createSafeStyleSheet } from '../src/surveys/safeStyleSheet'

describe('createSafeStyleSheet', () => {
  it('delegates to StyleSheet.create when the React Native runtime is present', () => {
    // vi-expo's StyleSheet.create is an identity passthrough, so a returned value
    // could come from delegation or the fallback. Mock a distinct sentinel so the
    // delegation path is observable: a result of `sentinel` can only come from create.
    const sentinel = { container: { padding: 10 } }
    const createSpy = vi.spyOn(StyleSheet, 'create').mockReturnValue(sentinel as never)
    const input = { container: { padding: 10 } }

    const result = createSafeStyleSheet(input)

    expect(createSpy).toHaveBeenCalledWith(input)
    expect(result).toBe(sentinel)
    // clearMocks resets call counts but not the implementation; restore so the
    // sentinel return doesn't leak into other tests in this file.
    createSpy.mockRestore()
  })

  it('falls back to the raw style map when StyleSheet is unavailable', async () => {
    vi.resetModules()
    vi.doMock('react-native', () => ({ StyleSheet: undefined }))
    const { createSafeStyleSheet: createWithoutRuntime } = await import('../src/surveys/safeStyleSheet')
    const input = { container: { padding: 10 } }

    expect(createWithoutRuntime(input)).toBe(input)
    vi.doUnmock('react-native')
  })
})
