/**
 * Key-value store for small extension state. Implementations backed by
 * synchronous persistence may return immediately, while asynchronous stores
 * (for example IndexedDB) may return promises. Consumers can await either.
 *
 * Keys map verbatim to the host client's shared persistence. In browser-v1,
 * unknown keys are normally included as event properties, collisions overwrite
 * host/core state, and reset clears them. Every SDK-owned key therefore needs an
 * explicit event/hidden/derived exposure policy in each host, and sensitive data
 * must not be stored unless its transmission is approved. Values must be
 * JSON-serializable.
 */
export interface KeyValueStore {
    /**
     * Read a value by key.
     *
     * @returns The stored value, or `undefined` when the key is missing.
     */
    get<T = unknown>(key: string): T | undefined | Promise<T | undefined>
    /**
     * Forward a JSON-serializable value, including nullish values, to the host's
     * native persistence. `undefined` is not portable or durable storage.
     */
    set(key: string, value: unknown): void | Promise<void>
    /** Remove a value by key. This is the portable deletion operation. */
    remove(key: string): void | Promise<void>
}
