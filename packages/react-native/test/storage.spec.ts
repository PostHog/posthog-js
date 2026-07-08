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
      let resolveRead: (value: string) => void
      mockedOptionalFileSystem!.readAsStringAsync.mockClear()
      mockedOptionalFileSystem!.readAsStringAsync.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveRead = resolve
          })
      )
      storage = createEventsStorage(buildOptimisticAsyncStorage()!)

      expect(storage.getItem('foo')).toEqual(undefined)
      resolveRead!(
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
      storage.setItem('foo', 'bar2')
      // Coalesced: the in-memory cache updates synchronously, but the disk
      // write is debounced. waitForPersist drains it.
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

      // waitForPersist drains the scheduled write synchronously and then awaits
      // the in-flight async write — so the in-flight promise stays pending until
      // we resolve it below.
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

      // Before the debounce fires, no write has been issued yet.
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

      // The write is initiated synchronously inside waitForPersist (the drain),
      // so it has already happened by the time the awaited Promise resolves —
      // without the drain, the debounced write wouldn't have fired yet.
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
      // First write fails, second succeeds — the timer handle must reset even
      // on failure so subsequent mutations can schedule fresh writes.
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

    it('swallows sync throws from the scheduled persist callback', () => {
      // A custom storage backend whose setItem throws *synchronously* (vs.
      // returning a rejected Promise) must not surface as an unhandled error
      // from the debounce timer. Async storage wraps sync throws automatically
      // (async function semantics), so we exercise this path with a
      // directly-constructed instance over a sync stub, firing the timer with
      // fake timers.
      jest.useFakeTimers()
      try {
        const syncThrowingStorage = {
          getItem: () => null,
          setItem: () => {
            throw new Error('sync throw from storage backend')
          },
        }
        const syncStorage = new PostHogRNStorage(syncThrowingStorage, '.test-sync.json')
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

        syncStorage.setItem('a', '1')
        jest.runOnlyPendingTimers()

        expect(consoleSpy).toHaveBeenCalledWith('PostHog storage scheduled persist threw:', expect.any(Error))
        consoleSpy.mockRestore()
      } finally {
        jest.useRealTimers()
      }
    })

    it('handles concurrent waitForPersist calls without losing writes', async () => {
      // Two concurrent waitForPersist calls should both resolve: the first
      // drains the scheduled write; the second sees an empty timer slot
      // (already drained) and just awaits the same in-flight promise.
      let resolveWrite: () => void
      const writePromise = new Promise<void>((resolve) => {
        resolveWrite = resolve
      })
      mockedOptionalFileSystem!.writeAsStringAsync.mockImplementation(() => writePromise)

      storage.setItem('a', '1')

      const wait1 = storage.waitForPersist()
      const wait2 = storage.waitForPersist()

      // Only one disk write in flight — the second drain was a no-op.
      expect(mockedOptionalFileSystem!.writeAsStringAsync).toHaveBeenCalledTimes(1)

      resolveWrite!()
      await Promise.all([wait1, wait2])
    })

    it('does not include captures arriving during a waitForPersist await in the wait', async () => {
      // waitForPersist waits for writes pending at call time. A capture that
      // arrives mid-await schedules its own write that fires afterwards — the
      // caller only got durability up to the moment of the call.
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

      // Resolve the first write — waitForPersist resolves without waiting for
      // the second write to fire.
      resolveFirst!()
      await waitPromise

      expect(mockedOptionalFileSystem!.writeAsStringAsync).toHaveBeenCalledTimes(1)

      // A second waitForPersist drains the queued write.
      await storage.waitForPersist()
      expect(mockedOptionalFileSystem!.writeAsStringAsync).toHaveBeenCalledTimes(2)
    })

    it('waitForPersist swallows sync throws from the drained persist', async () => {
      // The "never throws" contract must hold on the drain path too.
      const syncThrowingStorage = {
        getItem: () => null,
        setItem: () => {
          throw new Error('sync throw from storage backend')
        },
      }
      const syncStorage = new PostHogRNStorage(syncThrowingStorage, '.test-sync.json')
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      syncStorage.setItem('a', '1')
      await expect(syncStorage.waitForPersist()).resolves.toBeUndefined()

      expect(consoleSpy).toHaveBeenCalledWith('PostHog storage drain persist threw:', expect.any(Error))
      consoleSpy.mockRestore()
    })

    it('fires the debounced write on its own after the debounce window', () => {
      // Every other test forces the write via waitForPersist() — this one lets
      // the timer fire so a regression that broke timer-driven persistence
      // (e.g. schedulePersist never arming) wouldn't pass silently.
      jest.useFakeTimers()
      try {
        const cache: Record<string, string> = {}
        const sync = new PostHogRNStorage(
          {
            getItem: (k: string) => cache[k] ?? null,
            setItem: (k: string, v: string) => {
              cache[k] = v
            },
          },
          '.test-timer.json'
        )
        sync.setItem('a', '1')
        expect(cache['.test-timer.json']).toBeUndefined()
        jest.advanceTimersByTime(100)
        expect(JSON.parse(cache['.test-timer.json']).content.a).toBe('1')
      } finally {
        jest.useRealTimers()
      }
    })

    it('does not reset the timer on later mutations — write fires within one window of the first', () => {
      // Guards the "arm-once, no starvation" property. A textbook debounce that
      // clears-and-reschedules on every mutation would push the write out
      // indefinitely under a continuous stream — this test would fail under that
      // shape.
      jest.useFakeTimers()
      try {
        const cache: Record<string, string> = {}
        const sync = new PostHogRNStorage(
          {
            getItem: (k: string) => cache[k] ?? null,
            setItem: (k: string, v: string) => {
              cache[k] = v
            },
          },
          '.test-bound.json'
        )
        sync.setItem('a', '1')
        jest.advanceTimersByTime(50)
        sync.setItem('a', '2')
        jest.advanceTimersByTime(50) // 100ms total from the first mutation
        // Fired within one window of the first mutation with the latest value.
        expect(JSON.parse(cache['.test-bound.json']).content.a).toBe('2')
      } finally {
        jest.useRealTimers()
      }
    })
  })
})
