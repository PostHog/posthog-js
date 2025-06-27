import { isPromise } from '../../posthog-core/src/utils'
import { PostHogCustomStorage } from './types'

const POSTHOG_STORAGE_KEY = '.posthog-rn.json'
const POSTHOG_STORAGE_VERSION = 'v1'

type PostHogStorageContents = { [key: string]: any }

export class PostHogRNStorage {
  memoryCache: PostHogStorageContents = {}
  storage: PostHogCustomStorage
  preloadPromise: Promise<void> | undefined

  constructor(storage: PostHogCustomStorage) {
    this.storage = storage

    const preloadResult = this.storage.getItem(POSTHOG_STORAGE_KEY)

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

  persist(): void {
    const payload = {
      version: POSTHOG_STORAGE_VERSION,
      content: this.memoryCache,
    }

    void this.storage.setItem(POSTHOG_STORAGE_KEY, JSON.stringify(payload))
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
  constructor() {
    const cache: { [key: string]: any | undefined } = {}
    const storage = {
      getItem: (key: string) => cache[key],
      setItem: (key: string, value: string) => {
        cache[key] = value
      },
    }

    super(storage)
  }
}
