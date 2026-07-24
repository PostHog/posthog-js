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

/** Invokes teardown at most once and returns its first result to every caller. */
export function createDisposable(dispose: () => void | Promise<void>): Disposable {
    let active = true
    let result: void | Promise<void>
    return {
        dispose: () => {
            if (active) {
                active = false
                result = dispose()
            }
            return result
        },
    }
}
