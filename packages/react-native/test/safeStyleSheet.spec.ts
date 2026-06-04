import { StyleSheet } from 'react-native'

import { createSafeStyleSheet } from '../src/surveys/safeStyleSheet'

describe('createSafeStyleSheet', () => {
  it('delegates to StyleSheet.create when the React Native runtime is present', () => {
    // jest-expo's StyleSheet.create is an identity passthrough, so a returned value
    // could come from delegation or the fallback. Mock a distinct sentinel so the
    // delegation path is observable: a result of `sentinel` can only come from create.
    const sentinel = { container: { padding: 10 } }
    const createSpy = jest.spyOn(StyleSheet, 'create').mockReturnValue(sentinel as never)
    const input = { container: { padding: 10 } }

    const result = createSafeStyleSheet(input)

    expect(createSpy).toHaveBeenCalledWith(input)
    expect(result).toBe(sentinel)
  })

  it('falls back to the raw style map when StyleSheet is unavailable', () => {
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({ StyleSheet: undefined }))
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolated require exercises the no-runtime branch
      const { createSafeStyleSheet: createWithoutRuntime } = require('../src/surveys/safeStyleSheet')
      const input = { container: { padding: 10 } }

      expect(createWithoutRuntime(input)).toBe(input)
    })
  })
})
