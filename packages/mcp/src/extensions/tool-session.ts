import type { MCPAnalyticsData, McpEvent, MCPAnalyticsSessionSource, SessionInfo } from '../types'

interface ToolSession {
  data: MCPAnalyticsData
  sessionId: string
  sessionSource: MCPAnalyticsSessionSource | undefined
  /** The identity and client this call resolved, which a later request on the same session may replace. */
  attribution: SessionInfo
}

interface AsyncLocalStorageLike<T> {
  run<R>(store: T, fn: () => R): R
  getStore(): T | undefined
}

type AsyncLocalStorageConstructor = new <T>() => AsyncLocalStorageLike<T>

// `getBuiltinModule` loads it synchronously without a static `node:` import, so a
// runtime without it (an edge worker with no Node compatibility) still loads us.
function loadAsyncLocalStorage(): AsyncLocalStorageConstructor | undefined {
  try {
    const getBuiltinModule = (
      globalThis as { process?: { getBuiltinModule?: (id: string) => { AsyncLocalStorage?: unknown } | undefined } }
    ).process?.getBuiltinModule
    return getBuiltinModule?.('node:async_hooks')?.AsyncLocalStorage as AsyncLocalStorageConstructor | undefined
  } catch {
    return undefined
  }
}

const AsyncLocalStorageImpl = loadAsyncLocalStorage()
const toolSessions = AsyncLocalStorageImpl ? new AsyncLocalStorageImpl<ToolSession>() : undefined

/**
 * Runs a tool body with its call's session in scope. A concurrent request may
 * rewrite the instance's session while the tool awaits, so a custom event the
 * tool captures reads its session from here (see {@link currentToolSession}).
 */
export function runInToolSession<R>(
  data: MCPAnalyticsData,
  prepared: { event: McpEvent; requestAttribution: SessionInfo } | null,
  fn: () => R
): R {
  const sessionId = prepared?.event.sessionId
  if (!toolSessions || !prepared || !sessionId) {
    return fn()
  }
  return toolSessions.run(
    { data, sessionId, sessionSource: prepared.event.sessionSource, attribution: prepared.requestAttribution },
    fn
  )
}

/** The running tool call's session on this server, if there is one. */
export function currentToolSession(data: MCPAnalyticsData): ToolSession | undefined {
  const session = toolSessions?.getStore()
  return session?.data === data ? session : undefined
}
