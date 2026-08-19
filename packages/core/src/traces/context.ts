import type { Span } from '@posthog/types'
import type { SpanContextManager } from './types'

/**
 * Synchronous active-span tracking.
 *
 * Restores the previous active span when the callback returns, which for an
 * async callback means when it returns its promise — not when that promise
 * settles. Spans started after an `await` inside the callback therefore won't
 * see it as active.
 *
 * This is the browser's documented limitation and the fallback for any runtime
 * without an ambient async context primitive. Node injects an
 * `AsyncLocalStorage`-backed manager instead, which carries activation across
 * `await`. Either way, the explicit `parent` option is the escape hatch.
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
