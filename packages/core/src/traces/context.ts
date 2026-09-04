import type { Span } from '@posthog/types'
import type { SpanContextManager } from './types'

/**
 * Synchronous active-span tracking: restores the previous active span when the
 * callback returns, which for an async callback means when it returns its
 * promise — so spans started after an `await` won't see it as active.
 *
 * The fallback for runtimes with no ambient async context; Node injects an
 * `AsyncLocalStorage`-backed manager instead. `parent` is the escape hatch.
 */
export class SyncSpanContextManager implements SpanContextManager {
  private _active: Span | undefined

  active(): Span | undefined {
    return this._active
  }

  with<T>(span: Span, fn: () => T): T {
    const previous = this._active
    this._active = span
    try {
      return fn()
    } finally {
      this._active = previous
    }
  }
}
