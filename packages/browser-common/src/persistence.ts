/**
 * Async key-value store for small extension state. Backed by whatever the
 * client provides — a synchronous store resolves immediately, an asynchronous
 * one (e.g. IndexedDB) does real I/O — so reads and writes are always awaited.
 *
 * The store is namespaced to the client instance, so keys are local to the
 * extension and never collide with core SDK state. Values must be
 * JSON-serializable; setting `null`/`undefined` removes the key.
 */
export interface KeyValueStore {
    /**
     * Read a value by key.
     *
     * @returns The stored value, or `undefined` when the key is missing.
     */
    get<T = unknown>(key: string): Promise<T | undefined>
    /**
     * Store a JSON-serializable value by key. Passing `null` or `undefined`
     * removes the key instead of persisting that value.
     */
    set(key: string, value: unknown): Promise<void>
    /** Remove a value by key. Resolves successfully when the key is already absent. */
    remove(key: string): Promise<void>
}
