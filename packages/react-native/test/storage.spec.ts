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
      // First write fails, second succeeds — the timer handle must reset
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

    it('swallows sync throws from the scheduled persist callback', async () => {
      // A custom storage backend whose setItem throws *synchronously*
      // (vs. returning a rejected Promise) must not surface as an
      // unhandled error from the timer. Async storage wraps sync throws
      // automatically (async function semantics), so we exercise this
      // path with a directly-constructed instance over a sync stub.
      const syncThrowingStorage = {
        getItem: () => null,
        setItem: () => {
          throw new Error('sync throw from storage backend')
        },
      }
      const syncStorage = new PostHogRNStorage(syncThrowingStorage, '.test-sync.json')
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      syncStorage.setItem('a', '1')
      // Yield a macrotask so the scheduled setTimeout(0) fires.
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(consoleSpy).toHaveBeenCalledWith('PostHog storage scheduled persist threw:', expect.any(Error))
      consoleSpy.mockRestore()
    })

    it('handles concurrent waitForPersist calls without losing writes', async () => {
      // Two concurrent waitForPersist calls should both resolve correctly:
      // the first drains the scheduled write; the second sees an empty
      // timer slot (already drained) and just awaits the same in-flight
      // promise. JS single-threaded model means no race — the drain runs
      // synchronously to completion before the second call starts.
      let resolveWrite: () => void
      const writePromise = new Promise<void>((resolve) => {
        resolveWrite = resolve
      })
      mockedOptionalFileSystem!.writeAsStringAsync.mockImplementation(() => writePromise)

      storage.setItem('a', '1')

      const wait1 = storage.waitForPersist()
      const wait2 = storage.waitForPersist()

      // Only one disk write should be in flight (drain was a no-op for
      // the second call because the first had already drained the timer).
      expect(mockedOptionalFileSystem!.writeAsStringAsync).toHaveBeenCalledTimes(1)

      resolveWrite!()
      await Promise.all([wait1, wait2])
    })

    it('does not include captures arriving during a waitForPersist await in the wait', async () => {
      // waitForPersist promises to wait for writes pending at call time.
      // A capture that arrives mid-await schedules its own subsequent
      // write that fires after waitForPersist returns. This is correct
      // semantics — the caller (e.g. AppState background) only got the
      // durability up to the moment of the call.
      let resolveFirst: () => void
      const firstWrite = new Promise<void>((resolve) => {
        resolveFirst = resolve
      })
      mockedOptionalFileSystem!.writeAsStringAsync.mockImplementationOnce(() => firstWrite)
      mockedOptionalFileSystem!.writeAsStringAsync.mockResolvedValue(undefined)

      storage.setItem('first', '1')
      const waitPromise = storage.waitForPersist()

      // Mid-await, a new mutation arrives.
      storage.setItem('second', '2')

      // The first write is still in flight; only one disk write so far.
      expect(mockedOptionalFileSystem!.writeAsStringAsync).toHaveBeenCalledTimes(1)

      // Resolve the first write — waitForPersist should resolve without
      // waiting for the second write to fire.
      resolveFirst!()
      await waitPromise

      // After waitForPersist returns, the second write hasn't fired yet
      // (still scheduled for the next tick).
      expect(mockedOptionalFileSystem!.writeAsStringAsync).toHaveBeenCalledTimes(1)

      // A second waitForPersist drains the queued write and confirms.
      await storage.waitForPersist()
      expect(mockedOptionalFileSystem!.writeAsStringAsync).toHaveBeenCalledTimes(2)
    })

    it('waitForPersist swallows sync throws from the drained persist', async () => {
      // Same scenario but on the drain path — waitForPersist is
      // documented as "never throws" and must honor that even when the
      // forced persist throws synchronously.
      const syncThrowingStorage = {
        getItem: () => null,
        setItem: () => {
          throw new Error('sync throw from storage backend')
        },
      }
      const syncStorage = new PostHogRNStorage(syncThrowingStorage, '.test-sync.json')
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      syncStorage.setItem('a', '1')
      // Drain via waitForPersist before the timer fires.
      await expect(syncStorage.waitForPersist()).resolves.toBeUndefined()

      expect(consoleSpy).toHaveBeenCalledWith('PostHog storage drain persist threw:', expect.any(Error))
      consoleSpy.mockRestore()
    })
  })
})
