import { PostHogPersistedProperty } from '@posthog/core'

/**
 * In-process storage adapter for `PostHogCoreStateless`. The MCP SDK doesn't
 * persist anything across restarts — every server gets a fresh client — so a
 * plain object is enough. Mirrors `PostHogMemoryStorage` from `posthog-node`.
 */
export class PostHogMemoryStorage {
  private _memoryStorage: { [key: string]: unknown } = {}

  getProperty(key: PostHogPersistedProperty): unknown {
    return this._memoryStorage[key]
  }

  setProperty(key: PostHogPersistedProperty, value: unknown | null): void {
    this._memoryStorage[key] = value !== null ? value : undefined
  }
}
