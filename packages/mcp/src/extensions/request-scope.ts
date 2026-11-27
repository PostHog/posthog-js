import type { MCPAnalyticsData, McpEvent, MCPAnalyticsSessionSource, SessionInfo } from '../types'

export interface RequestScope {
  data: MCPAnalyticsData
  sessionId: string
  sessionSource: MCPAnalyticsSessionSource | undefined
  /** Snapshot: a later request on the same session may replace the shared identity. */
  attribution: SessionInfo
  pending?: PendingCustomEvents
}

/**
 * Custom events captured while a call's session is a handle minted for it. That
 * handle groups the call only once its result delivers it, so the events wait
 * until the call settles and then take the call's own session.
 */
export interface PendingCustomEvents {
  events: McpEvent[]
  settled?: { sessionId: string | undefined; sessionSource: MCPAnalyticsSessionSource | undefined }
  dropped?: number
}

// A call holds its custom events until it settles; beyond this many, the rest are dropped.
export const MAX_HELD_CUSTOM_EVENTS = 1000

/**
 * Holds a custom event until its call settles, fixed as it was when captured: its
 * top-level properties and options are copied, and its duration is the capture's.
 */
export function holdCustomEvent(
  pending: PendingCustomEvents,
  event: McpEvent,
  logger: (message: string) => void
): void {
  if (pending.events.length >= MAX_HELD_CUSTOM_EVENTS) {
    pending.dropped = (pending.dropped ?? 0) + 1
    if (pending.dropped === 1) {
      logger(`Warning: a tool call captured more than ${MAX_HELD_CUSTOM_EVENTS} custom events; dropping the rest`)
    }
    return
  }
  try {
    pending.events.push({
      ...event,
      properties: event.properties && { ...event.properties },
      eventOptions: event.eventOptions && { ...event.eventOptions },
      duration: 0,
    })
  } catch (error) {
    logger(`Warning: dropped a custom event whose properties could not be copied - ${error}`)
  }
}

interface AsyncLocalStorageLike<T> {
  run<R>(store: T, fn: () => R): R
  getStore(): T | undefined
}

function createScopeStore(candidate: unknown): AsyncLocalStorageLike<RequestScope> | undefined {
  try {
    if (typeof candidate !== 'function') {
      return undefined
    }
    const store = new (candidate as new () => AsyncLocalStorageLike<RequestScope>)()
    return typeof store.run === 'function' && typeof store.getStore === 'function' ? store : undefined
  } catch {
    return undefined
  }
}

// Node, Bun, Deno and Workers with `nodejs_compat` have `getBuiltinModule`, which
// loads it without a static `node:` import; Vercel Edge has a global.
function findSynchronously(): AsyncLocalStorageLike<RequestScope> | undefined {
  const runtime = globalThis as {
    AsyncLocalStorage?: unknown
    process?: { getBuiltinModule?: (id: string) => { AsyncLocalStorage?: unknown } | undefined }
  }
  let builtin: unknown
  try {
    builtin = runtime.process?.getBuiltinModule?.('node:async_hooks')?.AsyncLocalStorage
  } catch {
    builtin = undefined
  }
  return createScopeStore(builtin) ?? createScopeStore(runtime.AsyncLocalStorage)
}

// Workers with only `nodejs_als` expose it to a module import and nowhere else. The
// specifier is a variable so bundlers leave the import to the runtime, where it
// fails cleanly when the module does not exist.
async function importAsyncHooks(): Promise<AsyncLocalStorageLike<RequestScope> | undefined> {
  const moduleId = 'node:async_hooks'
  try {
    const module = (await import(/* webpackIgnore: true */ /* @vite-ignore */ moduleId)) as {
      AsyncLocalStorage?: unknown
    }
    return createScopeStore(module.AsyncLocalStorage)
  } catch {
    return undefined
  }
}

let scopes = findSynchronously()
let lookup: Promise<AsyncLocalStorageLike<RequestScope> | undefined> | undefined

function requestScopes(): Promise<AsyncLocalStorageLike<RequestScope> | undefined> {
  if (scopes) {
    return Promise.resolve(scopes)
  }
  lookup ??= importAsyncHooks().then((found) => (scopes = found))
  return lookup
}

/**
 * Whether custom events can be told apart by request. Without async context nothing
 * says which request one belongs to, so it cannot borrow the instance's session:
 * that is the last caller's.
 */
export async function canScopeRequests(): Promise<boolean> {
  return (await requestScopes()) !== undefined
}

/** A concurrent request may rewrite the instance's session while the handler awaits, so custom events read session and identity from this scope. */
export async function runInRequestScope<R>(
  data: MCPAnalyticsData,
  prepared: { event: McpEvent; requestAttribution: SessionInfo } | null,
  fn: () => Promise<R>,
  pending?: PendingCustomEvents
): Promise<R> {
  const store = await requestScopes()
  const sessionId = prepared?.event.sessionId
  if (!store || !prepared || !sessionId) {
    return fn()
  }
  return store.run(
    { data, sessionId, sessionSource: prepared.event.sessionSource, attribution: prepared.requestAttribution, pending },
    fn
  )
}

export function currentRequestScope(data: MCPAnalyticsData): RequestScope | undefined {
  const scope = scopes?.getStore()
  return scope?.data === data ? scope : undefined
}
