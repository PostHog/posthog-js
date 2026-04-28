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
   */
  async waitForPersist(): Promise<void> {
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

  getItem(key: string): any | null | undefined {
    return this.memoryCache[key]
  }
  setItem(key: string, value: any): void {
    this.memoryCache[key] = value
    this.persist()
  }
  removeItem(key: string): void {
    delete this.memoryCache[key]
    this.persist()
  }
  clear(): void {
    for (const key in this.memoryCache) {
      delete this.memoryCache[key]
    }
    this.persist()
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
