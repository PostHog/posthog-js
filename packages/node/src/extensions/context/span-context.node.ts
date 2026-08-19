import { AsyncLocalStorage } from 'node:async_hooks'
import type { Span, SpanContextManager } from '@posthog/core'

/**
 * Active-span tracking backed by `AsyncLocalStorage`, so a span stays active
 * across `await` boundaries and through any async work its callback starts.
 *
 * Lives here rather than in core because core ships to browsers, edge runtimes
 * and React Native and must not import `node:async_hooks`. The edge entrypoint
 * falls back to core's synchronous manager, matching how `initializeContext`
 * already differs between the two builds.
 */
export class AsyncLocalStorageSpanContextManager implements SpanContextManager {
  private readonly _storage = new AsyncLocalStorage<Span>()

  active(): Span | undefined {
    return this._storage.getStore()
  }

  with<T>(span: Span, fn: () => T): T {
    return this._storage.run(span, fn)
  }
}
