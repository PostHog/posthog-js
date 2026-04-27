import { isPromise } from '@posthog/core'
import { PostHogCustomStorage } from './types'

// Module-local: SDK-internal detail, not part of any public or reachable
// surface. The factory functions below are the only way to obtain a storage
// instance bound to one of these files.
const EVENTS_STORAGE_FILE = '.posthog-rn.json'
const LOGS_STORAGE_FILE = '.posthog-rn-logs.json'
const POSTHOG_STORAGE_VERSION = 'v1'

type PostHogStorageContents = { [key: string]: any }

export class PostHogRNStorage {
  memoryCache: PostHogStorageContents = {}
  storage: PostHogCustomStorage
  preloadPromise: Promise<void> | undefined
  private _storageKey: string
  private _pendingPromises: Set<Promise<void>> = new Set()
  // Tick-level write coalescing. Each setItem/removeItem/clear mutates
  // memoryCache synchronously, then arms a single setTimeout(0) that calls
  // persist() once on the next macrotask boundary with the final state.
  // Multiple sync mutations within the same tick collapse into one write
  // (which is the same total bytes today, but one fewer JSON.stringify and
  // one fewer storage.setItem round-trip). Lifecycle paths that need
  // durability now (AppState background, flushStorage, shutdown) call
  // waitForPersist, which drains the scheduled write synchronously before
  // awaiting in-flight async writes.
  private _persistScheduled = false
  private _persistTimer?: ReturnType<typeof setTimeout>

  // Prefer the `create*Storage` factories below over calling this directly —
  // they're the only callers that know which file to bind to.
  constructor(storage: PostHogCustomStorage, storageKey: string) {
    this.storage = storage
    this._storageKey = storageKey

    const preloadResult = this.storage.getItem(this._storageKey)

    if (isPromise(preloadResult)) {
      this.preloadPromise = preloadResult.then((res) => {
        this.populateMemoryCache(res)
      })

      this.preloadPromise?.finally(() => {
        this.preloadPromise = undefined
      })
    } else {
      this.populateMemoryCache(preloadResult)
    }
  }

  /**
   * Waits for all pending storage persist operations to complete.
   * This ensures data has been written to the underlying storage before proceeding.
   * This method never throws - errors are logged but swallowed.
   *
   * If a write is currently scheduled but hasn't yet fired (the timer is
   * pending), it is drained synchronously here before the await resolves —
   * this preserves the durability contract for flushStorage callers
   * (`posthog-core-stateless.ts:1131` "Wait for storage to complete to
   * prevent duplicate events on app crash") under tick-level coalescing.
   */
  async waitForPersist(): Promise<void> {
    this._drainScheduledPersist()
    try {
      if (this._pendingPromises.size > 0) {
        await Promise.all(this._pendingPromises)
      }
    } catch {
      // Errors already logged in persist(), safe to ignore here
    }
  }

  persist(): void {
    const payload = {
      version: POSTHOG_STORAGE_VERSION,
      content: this.memoryCache,
    }

    const result = this.storage.setItem(this._storageKey, JSON.stringify(payload))

    // Track async persist operations so we can wait for them if needed
    if (isPromise(result)) {
      const promise = result
        .catch((err) => {
          console.warn('PostHog storage persist failed:', err)
        })
        .finally(() => {
          this._pendingPromises.delete(promise)
        })
      this._pendingPromises.add(promise)
    }
  }

  // Schedules a single persist() on the next macrotask. Repeated calls
  // within the same tick are no-ops — the in-memory mutation is already in
  // memoryCache, and the scheduled fire will read the final state.
  private schedulePersist(): void {
    if (this._persistScheduled) return
    this._persistScheduled = true
    this._persistTimer = setTimeout(() => {
      // Reset before persist() so a sync throw from the storage backend
      // can't leave the scheduler stuck. Async errors are caught inside
      // persist() itself.
      this._persistTimer = undefined
      this._persistScheduled = false
      this.persist()
    }, 0)
  }

  // Force a scheduled persist to fire now. Used by waitForPersist (and
  // therefore by flushStorage / AppState background / shutdown) so callers
  // awaiting durability are guaranteed the latest state has been handed to
  // the storage backend before they resume.
  private _drainScheduledPersist(): void {
    if (!this._persistScheduled) return
    if (this._persistTimer) {
      clearTimeout(this._persistTimer)
      this._persistTimer = undefined
    }
    this._persistScheduled = false
    this.persist()
  }

  getItem(key: string): any | null | undefined {
    return this.memoryCache[key]
  }
  setItem(key: string, value: any): void {
    this.memoryCache[key] = value
    this.schedulePersist()
  }
  removeItem(key: string): void {
    delete this.memoryCache[key]
    this.schedulePersist()
  }
  clear(): void {
    for (const key in this.memoryCache) {
      delete this.memoryCache[key]
    }
    this.schedulePersist()
  }
  getAllKeys(): readonly string[] {
    return Object.keys(this.memoryCache)
  }

  populateMemoryCache(res: string | null): void {
    try {
      const data = res ? JSON.parse(res).content : {}

      for (const key in data) {
        this.memoryCache[key] = data[key]
      }
    } catch (e) {
      console.warn(
        "PostHog failed to load persisted data from storage. This is likely because the storage format is. We'll reset the storage.",
        e
      )
    }
  }
}

export class PostHogRNSyncMemoryStorage extends PostHogRNStorage {
  constructor(storageKey: string) {
    const cache: { [key: string]: any | undefined } = {}
    const storage = {
      getItem: (key: string) => cache[key],
      setItem: (key: string, value: string) => {
        cache[key] = value
      },
    }

    super(storage, storageKey)
  }
}

// Factory functions that bind the storage instance to the correct SDK-internal
// file. The file names never leave this module — callers (including tests)
// reach storages only through these helpers.
export function createEventsStorage(customStorage: PostHogCustomStorage): PostHogRNStorage {
  return new PostHogRNStorage(customStorage, EVENTS_STORAGE_FILE)
}

export function createLogsStorage(customStorage: PostHogCustomStorage): PostHogRNStorage {
  return new PostHogRNStorage(customStorage, LOGS_STORAGE_FILE)
}

export function createEventsMemoryStorage(): PostHogRNStorage {
  return new PostHogRNSyncMemoryStorage(EVENTS_STORAGE_FILE)
}

export function createLogsMemoryStorage(): PostHogRNStorage {
  return new PostHogRNSyncMemoryStorage(LOGS_STORAGE_FILE)
}
