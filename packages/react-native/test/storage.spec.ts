// Mock OptionalExpoFileSystem with legacy APIs (readAsStringAsync)
jest.mock('../src/optional/OptionalExpoFileSystem', () => ({
  OptionalExpoFileSystem: {
    readAsStringAsync: jest.fn(),
    writeAsStringAsync: jest.fn(),
    documentDirectory: '/mock-doc-dir/',
  },
}))

import { PostHogRNStorage, createEventsStorage } from '../src/storage'
import { buildOptimisticAsyncStorage } from '../src/native-deps'
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

      storage = createEventsStorage(buildOptimisticAsyncStorage())
    })

    it('should load storage from the file system', async () => {
      expect(storage.getItem('foo')).toEqual(undefined)
      await storage.preloadPromise
      expect(mockedOptionalFileSystem!.readAsStringAsync).toHaveBeenCalledTimes(1)
      expect(storage.getItem('foo')).toEqual('bar')
    })

    it('should save storage to the file system', async () => {
      storage.setItem('foo', 'bar2')
      // Tick-coalesced: the in-memory cache is updated synchronously, but the
      // disk write fires on the next macrotask. waitForPersist drains it.
      expect(storage.getItem('foo')).toEqual('bar2')
      await storage.waitForPersist()
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

      // Trigger a persist (scheduled, not fired yet)
      storage.setItem('test', 'value')

      // waitForPersist drains the scheduled write synchronously and then
      // awaits the in-flight async write. So at this point, the in-flight
      // promise is pending until we resolve it below.
      let waitCompleted = false
      const waitPromise = storage.waitForPersist().then(() => {
        waitCompleted = true
      })

      // Wait should not have completed yet
      await Promise.resolve()
      expect(waitCompleted).toBe(false)

      // Now resolve the write
      resolveWrite!()
      await waitPromise

      // Wait should have completed
      expect(waitCompleted).toBe(true)
    })

    it('coalesces multiple sync setItem calls into a single persist', async () => {
      const resolvers: Array<() => void> = []
      mockedOptionalFileSystem!.writeAsStringAsync.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolvers.push(resolve)
          })
      )

      // Three synchronous mutations within the same tick.
      storage.setItem('a', '1')
      storage.setItem('b', '2')
      storage.setItem('c', '3')

      // Before the next tick, no write has fired yet.
      expect(resolvers.length).toBe(0)

      // waitForPersist drains the single scheduled write.
      const waitPromise = storage.waitForPersist()

      // Exactly one write was issued, with the final state of all three keys.
      expect(resolvers.length).toBe(1)
      const lastWrite = mockedOptionalFileSystem!.writeAsStringAsync.mock.calls.at(-1)![1]
      const written = JSON.parse(lastWrite as string)
      // Subset match — preload may or may not have completed by the time
      // persist() ran, so other keys (`foo`) are intentionally not asserted.
      expect(written.content).toMatchObject({ a: '1', b: '2', c: '3' })

      // Resolve and let waitForPersist complete.
      resolvers.forEach((r) => r())
      await waitPromise
    })

    it('preserves the final value when coalescing repeated writes to the same key', async () => {
      mockedOptionalFileSystem!.writeAsStringAsync.mockResolvedValue(undefined)

      storage.setItem('k', 'v1')
      storage.setItem('k', 'v2')
      storage.setItem('k', 'v3')
      await storage.waitForPersist()

      expect(mockedOptionalFileSystem!.writeAsStringAsync).toHaveBeenCalledTimes(1)
      const lastWrite = mockedOptionalFileSystem!.writeAsStringAsync.mock.calls.at(-1)![1]
      const written = JSON.parse(lastWrite as string)
      expect(written.content.k).toEqual('v3')
    })

    it('waitForPersist drains the scheduled write synchronously before awaiting', async () => {
      // Resolve writes immediately so we can isolate the drain timing.
      mockedOptionalFileSystem!.writeAsStringAsync.mockResolvedValue(undefined)

      storage.setItem('queue-advance', 'sent')

      // Without draining, the assertion below would fire before setTimeout(0)
      // had a chance. With draining inside waitForPersist, the storage write
      // is initiated synchronously inside waitForPersist and the call has
      // already happened by the time the awaited Promise resolves.
      await storage.waitForPersist()

      expect(mockedOptionalFileSystem!.writeAsStringAsync).toHaveBeenCalledTimes(1)
    })

    it('allows scheduling a fresh persist after the previous one fires', async () => {
      mockedOptionalFileSystem!.writeAsStringAsync.mockResolvedValue(undefined)

      storage.setItem('first', '1')
      await storage.waitForPersist()
      expect(mockedOptionalFileSystem!.writeAsStringAsync).toHaveBeenCalledTimes(1)

      storage.setItem('second', '2')
      await storage.waitForPersist()
      expect(mockedOptionalFileSystem!.writeAsStringAsync).toHaveBeenCalledTimes(2)
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

    it('keeps scheduling writes after a previous persist fails', async () => {
      // First write fails, second succeeds — the scheduled-flag must reset
      // even on failure so subsequent mutations can schedule fresh writes.
      let callCount = 0
      mockedOptionalFileSystem!.writeAsStringAsync.mockImplementation(() => {
        callCount += 1
        return callCount === 1 ? Promise.reject(new Error('first write failed')) : Promise.resolve()
      })
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      storage.setItem('a', '1')
      await storage.waitForPersist()

      storage.setItem('b', '2')
      await storage.waitForPersist()

      expect(callCount).toBe(2)
      consoleSpy.mockRestore()
    })
  })
})
