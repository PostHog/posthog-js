import type { MCPAnalyticsData, McpEvent, MCPAnalyticsSessionSource, SessionInfo } from '../types'

export interface RequestScope {
  data: MCPAnalyticsData
  sessionId: string
  sessionSource: MCPAnalyticsSessionSource | undefined
  /** Snapshot: a later request on the same session may replace the shared identity. */
  attribution: SessionInfo
}

interface AsyncLocalStorageLike<T> {
  run<R>(store: T, fn: () => R): R
  getStore(): T | undefined
}

type AsyncLocalStorageConstructor = new <T>() => AsyncLocalStorageLike<T>

// `getBuiltinModule` loads it synchronously without a static `node:` import, so a
// runtime without it still loads us. Edge runtimes that expose it as a global
// (Vercel Edge, Workers with `nodejs_als`) use that instead.
function loadAsyncLocalStorage(): AsyncLocalStorageConstructor | undefined {
  const runtime = globalThis as {
    AsyncLocalStorage?: unknown
    process?: { getBuiltinModule?: (id: string) => { AsyncLocalStorage?: unknown } | undefined }
  }
  try {
    return (runtime.process?.getBuiltinModule?.('node:async_hooks')?.AsyncLocalStorage ?? runtime.AsyncLocalStorage) as
      | AsyncLocalStorageConstructor
      | undefined
  } catch {
    return runtime.AsyncLocalStorage as AsyncLocalStorageConstructor | undefined
  }
}

const AsyncLocalStorageImpl = loadAsyncLocalStorage()
const scopes = AsyncLocalStorageImpl ? new AsyncLocalStorageImpl<RequestScope>() : undefined

/**
 * Without async context nothing tells which request a custom event belongs to, so
 * it cannot borrow the instance's session: that is the last caller's.
 */
export const canScopeRequests = scopes !== undefined

/** A concurrent request may rewrite the instance's session while the handler awaits, so custom events read session and identity from this scope. */
export function runInRequestScope<R>(
  data: MCPAnalyticsData,
  prepared: { event: McpEvent; requestAttribution: SessionInfo } | null,
  fn: () => Promise<R>
): Promise<R> {
  const sessionId = prepared?.event.sessionId
  if (!scopes || !prepared || !sessionId) {
    return fn()
  }
  return scopes.run(
    { data, sessionId, sessionSource: prepared.event.sessionSource, attribution: prepared.requestAttribution },
    fn
  )
}

export function currentRequestScope(data: MCPAnalyticsData): RequestScope | undefined {
  const scope = scopes?.getStore()
  return scope?.data === data ? scope : undefined
}
