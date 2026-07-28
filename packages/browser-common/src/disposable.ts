import { isFunction } from '@posthog/core'

/** A resource handle with idempotent, best-effort cleanup. */
export interface Disposable {
    /** Release resources owned by this object. */
    dispose(): void
}

/** Invokes teardown at most once without awaiting Promise results. */
export function createDisposable(dispose: () => void): Disposable {
    let active = true
    return {
        dispose: () => {
            if (active) {
                active = false
                const result = dispose() as unknown
                if (result && isFunction((result as PromiseLike<void>).then)) {
                    void (result as PromiseLike<void>).then(undefined, () => {})
                }
            }
        },
    }
}
