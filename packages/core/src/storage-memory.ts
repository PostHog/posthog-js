import { PostHogPersistedProperty } from './types'

/**
 * In-process key/value storage for `PostHogPersistedProperty` values.
 *
 * Used by stateless / server-side clients that don't persist anything across
 * restarts (e.g. `posthog-node`, `@posthog/mcp`). A plain object is enough.
 */
export class PostHogMemoryStorage {
  private _memoryStorage: { [key in PostHogPersistedProperty]?: unknown } = {}

  getProperty(key: PostHogPersistedProperty): unknown | undefined {
    return this._memoryStorage[key]
  }

  setProperty(key: PostHogPersistedProperty, value: unknown | null): void {
    this._memoryStorage[key] = value !== null ? value : undefined
  }
}
