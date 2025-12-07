// Mock OptionalExpoFileSystem with legacy APIs (readAsStringAsync)
jest.mock('../src/optional/OptionalExpoFileSystem', () => ({
  OptionalExpoFileSystem: {
    readAsStringAsync: jest.fn(),
    writeAsStringAsync: jest.fn(),
    documentDirectory: '/mock-doc-dir/',
  },
}))

import { PostHogRNStorage } from '../src/storage'
import { buildOptimisiticAsyncStorage } from '../src/native-deps'
import { OptionalExpoFileSystem } from '../src/optional/OptionalExpoFileSystem'

const mockedOptionalFileSystem = jest.mocked(OptionalExpoFileSystem, true)

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}))

describe('PostHog React Native', () => {
  jest.useRealTimers()

  describe('storage', () => {
    let storage: PostHogRNStorage

    beforeEach(() => {
      jest.clearAllMocks()
    })

    it('should load storage from the file system', async () => {
      // Use a deferred promise so we can control when it resolves
      let resolveReadPromise: (value: string) => void
      const readPromise = new Promise<string>((resolve) => {
        resolveReadPromise = resolve
      })

      mockedOptionalFileSystem!.readAsStringAsync.mockReturnValue(readPromise)
      storage = new PostHogRNStorage(buildOptimisiticAsyncStorage())

      // Before promise resolves, value should be undefined
      expect(storage.getItem('foo')).toEqual(undefined)

      // Now resolve the promise
      resolveReadPromise!(
        JSON.stringify({
          version: 'v1',
          content: {
            foo: 'bar',
          },
        })
      )

      await storage.preloadPromise
      expect(mockedOptionalFileSystem!.readAsStringAsync).toHaveBeenCalledTimes(1)
      expect(storage.getItem('foo')).toEqual('bar')
    })

    it('should save storage to the file system', async () => {
      mockedOptionalFileSystem!.readAsStringAsync.mockResolvedValue(
        JSON.stringify({
          version: 'v1',
          content: {},
        })
      )

      storage = new PostHogRNStorage(buildOptimisiticAsyncStorage())
      await storage.preloadPromise

      storage.setItem('foo', 'bar2')
      expect(storage.getItem('foo')).toEqual('bar2')
      expect(mockedOptionalFileSystem!.writeAsStringAsync).toHaveBeenCalledWith(
        '/mock-doc-dir/.posthog-rn.json',
        JSON.stringify({
          version: 'v1',
          content: {
            foo: 'bar2',
          },
        })
      )
    })
  })
})
