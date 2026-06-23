/**
 * Something with an async-capable teardown. `dispose` may be async so
 * teardown can do final work — e.g. a last flush of buffered data — that the
 * client can await before it finishes shutting down.
 */
export interface Disposable {
    /**
     * Release resources owned by this object. Implementations should be
     * idempotent so callers can safely dispose during both extension teardown
     * and client shutdown.
     */
    dispose(): void | Promise<void>
}
