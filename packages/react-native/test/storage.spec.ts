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
      mockedOptionalFileSystem!.readAsStringAsync.mockImplementation(() => {
        const res = Promise.resolve(
          JSON.stringify({
            version: 'v1',
            content: {
              foo: 'bar',
            },
          })
        )
        return res
      })

      storage = new PostHogRNStorage(buildOptimisiticAsyncStorage())
    })

    it('should load storage from the file system', async () => {
      expect(storage.getItem('foo')).toEqual(undefined)
      await storage.preloadPromise
      expect(mockedOptionalFileSystem!.readAsStringAsync).toHaveBeenCalledTimes(1)
      expect(storage.getItem('foo')).toEqual('bar')
    })

    it('should save storage to the file system', async () => {
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

    it('should wait for async persist to complete with waitForPersist', async () => {
      let resolveWrite: () => void
      const writePromise = new Promise<void>((resolve) => {
        resolveWrite = resolve
      })

      mockedOptionalFileSystem!.writeAsStringAsync.mockImplementation(() => writePromise)

      // Trigger a persist
      storage.setItem('test', 'value')

      // At this point, the write is pending
      let waitCompleted = false
      const waitPromise = storage.waitForPersist().then(() => {
        waitCompleted = true
      })

      // Wait should not have completed yet
      await new Promise((r) => setTimeout(r, 5))
      expect(waitCompleted).toBe(false)

      // Now resolve the write
      resolveWrite!()
      await waitPromise

      // Wait should have completed
      expect(waitCompleted).toBe(true)
    })

    it('should wait for all pending persist operations', async () => {
      const resolvers: Array<() => void> = []
      mockedOptionalFileSystem!.writeAsStringAsync.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolvers.push(resolve)
          })
      )

      // Trigger multiple persists rapidly
      storage.setItem('a', '1')
      storage.setItem('b', '2')
      storage.setItem('c', '3')

      expect(resolvers.length).toBe(3)

      let waitCompleted = false
      const waitPromise = storage.waitForPersist().then(() => {
        waitCompleted = true
      })

      // Resolve first two, but not the third
      resolvers[0]()
      resolvers[1]()
      await new Promise((r) => setTimeout(r, 5))
      expect(waitCompleted).toBe(false)

      // Resolve the last one
      resolvers[2]()
      await waitPromise
      expect(waitCompleted).toBe(true)
    })

    it('should resolve waitForPersist immediately if no pending persist', async () => {
      // No writes pending
      await storage.waitForPersist()
      // Should complete immediately without error
    })

    it('should handle persist errors gracefully in waitForPersist', async () => {
      mockedOptionalFileSystem!.writeAsStringAsync.mockImplementation(() =>
        Promise.reject(new Error('Storage write failed'))
      )

      // Suppress console.warn for this test
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      // Trigger a persist that will fail
      storage.setItem('test', 'value')

      // waitForPersist should still resolve (not reject)
      await storage.waitForPersist()

      expect(consoleSpy).toHaveBeenCalledWith('PostHog storage persist failed:', expect.any(Error))
      consoleSpy.mockRestore()
    })
  })
})
