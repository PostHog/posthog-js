import { cacheToolListing } from './instrumentation'
import type { LoggerFn } from './logger'
import type { CompatibleToolsListLike, MCPServerLike } from '../types'

type MCPRequestHandler = NonNullable<ReturnType<MCPServerLike['_requestHandlers']['get']>>

type Connect = (this: FastMCPSessionLike, transport: unknown, ...rest: unknown[]) => Promise<void>

interface FastMCPSessionLike {
  readonly server: unknown
}

interface FastMCPModuleLike {
  FastMCPSession: { prototype: { connect: Connect } }
}

type RequestEntryPoint = (request: { headers?: unknown } | undefined, ...rest: unknown[]) => unknown

// Streamable HTTP requests arrive through `handleRequest`, legacy `/sse` posts through `handlePostMessage`.
const REQUEST_ENTRY_POINTS = ['handleRequest', 'handlePostMessage'] as const

type MessageHandler = (message: unknown, extra?: { requestInfo?: { headers?: unknown } }) => void

type HttpTransportLike = Partial<Record<(typeof REQUEST_ENTRY_POINTS)[number], RequestEntryPoint>> & {
  onmessage?: MessageHandler
}

interface HeaderStore {
  run<T>(headers: unknown, callback: () => T): T
  getStore(): unknown
}

// Loaded without an import so the package stays loadable where `node:async_hooks` does not exist.
function createHeaderStore(): HeaderStore | undefined {
  const runtime = globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }
  const hooks = runtime.process?.getBuiltinModule?.('node:async_hooks') as
    | { AsyncLocalStorage?: new () => HeaderStore }
    | undefined
  return hooks?.AsyncLocalStorage ? new hooks.AsyncLocalStorage() : undefined
}

const hooked = Symbol.for('posthog.mcp.fastmcp-connect')

function isFastMCPModule(value: unknown): value is FastMCPModuleLike {
  const session = (value as { FastMCPSession?: { prototype?: { connect?: unknown } } } | undefined)?.FastMCPSession
  return typeof session?.prototype?.connect === 'function'
}

/**
 * Runs `onSession` with each FastMCP session's low-level server before it
 * connects. FastMCP builds that server inside a private factory, once per HTTP
 * session or, when stateless, per request, and `connect` is the one public step
 * every session passes through first. Patches the module's session class, so it
 * covers every FastMCP server in the process; a second call is a no-op.
 */
export function hookFastMCPSessions(fastmcp: unknown, onSession: (server: unknown) => void, logger: LoggerFn): void {
  if (!isFastMCPModule(fastmcp)) {
    logger(
      'Warning: instrumentFastMCP expects the fastmcp module (import * as fastmcp from "fastmcp"); nothing was instrumented.'
    )
    return
  }
  const prototype = fastmcp.FastMCPSession.prototype
  const connect = prototype.connect
  if ((connect as unknown as Record<symbol, unknown>)[hooked]) {
    logger('Warning: instrumentFastMCP was already called for this fastmcp module; keeping the first setup.')
    return
  }
  const headerStore = createHeaderStore()
  const hookedConnect: Connect = async function (transport, ...rest) {
    const listTools = (this.server as MCPServerLike | undefined)?._requestHandlers?.get('tools/list')
    onSession(this.server)
    await primeToolListing(this.server as MCPServerLike, listTools, logger)
    if (headerStore) {
      forwardRequestHeaders(transport, headerStore)
    }
    await connect.call(this, transport, ...rest)
  }
  Object.defineProperty(hookedConnect, hooked, { value: true })
  prototype.connect = hookedConnect
}

/**
 * FastMCP's HTTP layer (mcp-proxy) bundles a transport that never passes request
 * headers to the server, so `extra.requestInfo` arrives empty. Each request
 * enters through `handleRequest` or `handlePostMessage` with the Node request,
 * and the transport dispatches its messages within that call, so the headers
 * are held for that call alone and put where the SDK's own transports put them,
 * `extra.requestInfo.headers`. Installed before `connect`, because FastMCP's
 * `connect` only returns after the client's `initialize` was handled.
 */
function forwardRequestHeaders(transport: unknown, store: HeaderStore): void {
  const target = transport as HttpTransportLike | undefined
  if (!target || !REQUEST_ENTRY_POINTS.some((name) => typeof target[name] === 'function')) {
    return
  }
  for (const name of REQUEST_ENTRY_POINTS) {
    const entryPoint = target[name]
    if (typeof entryPoint === 'function') {
      target[name] = function (this: unknown, request, ...rest) {
        return store.run(request?.headers, () => entryPoint.call(this, request, ...rest))
      }
    }
  }
  const withHeaders = (handler: MessageHandler): MessageHandler =>
    function (this: unknown, message, extra) {
      const headers = store.getStore()
      const forwarded =
        headers && !extra?.requestInfo?.headers ? { ...extra, requestInfo: { ...extra?.requestInfo, headers } } : extra
      return handler.call(this, message, forwarded)
    }
  // The server sets `onmessage` while connecting; a transport may keep it in an inherited accessor.
  const inherited = findAccessor(target, 'onmessage')
  let handler = target.onmessage
  Object.defineProperty(target, 'onmessage', {
    configurable: true,
    enumerable: true,
    get: () => handler,
    set: (next: unknown) => {
      handler = typeof next === 'function' ? withHeaders(next as MessageHandler) : (next as undefined)
      inherited?.set?.call(target, handler)
    },
  })
}

function findAccessor(target: object, key: string): PropertyDescriptor | undefined {
  for (let proto = Object.getPrototypeOf(target); proto; proto = Object.getPrototypeOf(proto)) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key)
    if (descriptor) {
      return descriptor.set ? descriptor : undefined
    }
  }
  return undefined
}

/**
 * Seeds the server with FastMCP's own tool listing. A stateless server serves
 * one request, so its first `tools/call` comes before any listing it saw, and
 * without one the SDK cannot tell that `context` is its own argument: it would
 * reach FastMCP's validation, which a strict schema rejects.
 */
async function primeToolListing(
  server: MCPServerLike,
  listTools: MCPRequestHandler | undefined,
  logger: LoggerFn
): Promise<void> {
  if (!listTools) {
    return
  }
  try {
    const listing = (await listTools({ method: 'tools/list', params: {} })) as CompatibleToolsListLike
    cacheToolListing(server, listing.tools ?? [])
  } catch (error) {
    logger(`Warning: instrumentFastMCP could not read the tool listing - ${error}`)
  }
}
