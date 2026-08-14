/**
 * Key-value store for small extension state. A host may initialize an asynchronous
 * backend before exposing synchronous operations over its in-memory buffer. Writes
 * must update that buffer before returning; ordered durable flushing remains the
 * host's responsibility. Reads treat `undefined` values as absent.
 *
 * Keys map verbatim to the host client's shared persistence. In browser-v1,
 * unknown keys are normally included as event properties, collisions overwrite
 * host/core state, and reset clears them. Every SDK-owned key therefore needs an
 * explicit event/hidden/derived exposure policy in each host, and sensitive data
 * must not be stored unless its transmission is approved. Values must be
 * JSON-serializable.
 */
export interface KeyValueStore {
    /** Populate the in-memory buffer from durable storage. Calls are idempotent. */
    initialize(): void | Promise<void>
    /** Read several initialized values in one operation. Missing keys are omitted. */
    get<T extends object>(keys: readonly (keyof T & string)[]): Partial<T>
    /** Read one initialized value by key, returning `undefined` when it is missing. */
    get<T = unknown>(key: string): T | undefined
    /**
     * Immediately update the initialized buffer. `null` is durable; `undefined` is
     * accepted for compatibility but treated as absent by reads and is not portable.
     */
    set(key: string, value: unknown): void
    /** Coherently update several related values in the initialized buffer. */
    set(values: Record<string, unknown>): void
    /** Remove one or several values from the initialized buffer in one operation. */
    remove(keyOrKeys: string | readonly string[]): void
}
