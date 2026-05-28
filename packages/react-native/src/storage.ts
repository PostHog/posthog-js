import { isPromise, safeSetTimeout } from '@posthog/core'
import { PostHogCustomStorage } from './types'

// Module-local: SDK-internal detail, not part of any public or reachable
// surface. The factory functions below are the only way to obtain a storage
// instance bound to one of these files.
const EVENTS_STORAGE_FILE = '.posthog-rn.json'
const LOGS_STORAGE_FILE = '.posthog-rn-logs.json'
const POSTHOG_STORAGE_VERSION = 'v1'

// Window over which storage mutations coalesce into one disk write. The
// single-blob storage shape re-serializes the full cache on every write, so an
// unbatched burst of N captures costs O(n²) bytes; coalescing collapses a
// same-tick burst to a single write. The mutation lands in memoryCache
// synchronously — only the disk write is deferred — and flush / AppState
// background / shutdown each force a synchronous write via waitForPersist, so
// the only data-loss window is a hard crash before the next drain.
//
// 100ms is chosen from the write-rate curve: at high burst rates the disk-write
// count is already floored by the events flushAt (a flush drains every 20
// events), and 100ms is enough to reach that floor while bounding worst-case
// loss to ~one flush batch. Larger windows don't reduce writes further (the
// floor is flushAt, not the window) and only widen the loss window when flushes
// aren't draining.
const PERSIST_DEBOUNCE_MS = 100

type PostHogStorageContents = { [key: string]: any }

export class PostHogRNStorage {
  memoryCache: PostHogStorageContents = {}
  storage: PostHogCustomStorage
  preloadPromise: Promise<void> | undefined
  private _storageKey: string
  private _pendingPromises: Set<Promise<void>> = new Set()
  // Single in-flight debounce timer. Its presence doubles as the "a write is
  // scheduled" flag — one source of truth. Armed on the first mutation in a
  // window and deliberately not reset by later mutations, so write latency is
  // bounded to PERSIST_DEBOUNCE_MS rather than starving under a continuous
  // stream of captures.
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
   * Waits for all pending storage persist operations to complete, so callers
   * (events flush, AppState background, shutdown) can rely on the latest state
   * having been handed to the storage backend before they resume — the
   * durability contract the events flush relies on to avoid replaying an
   * already-sent batch after an app crash.
   *
   * Drains any scheduled-but-not-yet-fired debounced write synchronously first,
   * then awaits in-flight async writes. Never throws: async errors are caught
   * in persist(), and sync throws from the drained persist() are caught in
   * _drainScheduledPersist(). No try/catch around Promise.all is needed because
   * every promise in _pendingPromises already has its own .catch applied — they
   * resolve, so Promise.all can't reject.
   */
  async waitForPersist(): Promise<void> {
    this._drainScheduledPersist()
    if (this._pendingPromises.size > 0) {
      await Promise.all(this._pendingPromises)
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

  // Arms a single debounced persist(). Repeated calls within the window are
  // no-ops — the mutation is already in memoryCache and the scheduled fire
  // reads the final state. safeSetTimeout unrefs in Node so a pending write
  // can't keep the process alive. Sync throws from persist() (e.g. a circular
  // value passed to JSON.stringify, or a custom storage backend that throws
  // synchronously) are caught so the timer callback can't surface as an
  // unhandled error in the RN runtime.
  private schedulePersist(): void {
    if (this._persistTimer !== undefined) {
      return
    }
    this._persistTimer = safeSetTimeout(() => {
      this._persistTimer = undefined
      try {
        this.persist()
      } catch (err) {
        console.warn('PostHog storage scheduled persist threw:', err)
      }
    }, PERSIST_DEBOUNCE_MS)
  }

  // Forces a scheduled persist to fire now. Used by waitForPersist (and thus by
  // flushStorage / AppState background / shutdown) so durability-sensitive
  // callers get the latest state to the backend without waiting out the
  // debounce. Catches sync throws so waitForPersist's never-throws contract
  // holds.
  private _drainScheduledPersist(): void {
    if (this._persistTimer === undefined) {
      return
    }
    clearTimeout(this._persistTimer)
    this._persistTimer = undefined
    try {
      this.persist()
    } catch (err) {
      console.warn('PostHog storage drain persist threw:', err)
    }
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
