/**
 * Structural feature probes.
 *
 * Every question about the shape of a server object is answered here, by
 * duck-typing the object in front of us — never by reading a package version or
 * a protocol constant. Two reasons this is a rule and not a preference:
 *
 * - The two SDK majors expose the same capability under different names (v1's
 *   `.tool()` vs v2's `.registerTool()`), so "which SDK is installed" answers a
 *   different question than "can this object register a tool".
 * - A single v2 server serves both protocol eras, request by request, so no
 *   module-level constant describes it. v2's exported `LATEST_PROTOCOL_VERSION`
 *   is `2025-11-25`.
 *
 * Nothing here imports `@modelcontextprotocol/*`; that boundary is pinned by
 * `sdk-import-boundary.test.ts`.
 */

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' ? (value as UnknownRecord) : undefined
}

function hasMethod(value: unknown, key: string): boolean {
  return typeof asRecord(value)?.[key] === 'function'
}

/** A high-level `McpServer` wrapper: it holds the low-level server on `.server`. */
export function hasNestedLowLevelServer(server: unknown): server is UnknownRecord & { server: UnknownRecord } {
  const record = asRecord(server)
  return !!record && 'server' in record && !!asRecord(record.server)
}

/** No `.server` property, so the object is itself the low-level `Server`. */
export function isBareServerShape(server: unknown): boolean {
  const record = asRecord(server)
  return !!record && !('server' in record)
}

/** The high-level registry we read tool metadata from and wrap callbacks in. */
export function hasToolRegistry(server: unknown): boolean {
  return !!asRecord(asRecord(server)?._registeredTools)
}

/**
 * The object can register a tool.
 *
 * v1 offers both `tool()` and `registerTool()`; v2 dropped the deprecated
 * `tool()` and keeps only `registerTool()`. Requiring `tool()` specifically is
 * what made `instrument()` reject every v2 high-level server — and, because
 * `instrument()` swallows compatibility errors, reject it silently.
 */
export function canRegisterTools(server: unknown): boolean {
  return hasMethod(server, 'registerTool') || hasMethod(server, 'tool')
}

/** Handler registration, which we patch to wrap late registrations. */
export function canSetRequestHandler(server: unknown): boolean {
  return hasMethod(server, 'setRequestHandler')
}

/** The live handler map we read and write directly. A real `Map` on both majors. */
export function hasRequestHandlerMap(server: unknown): boolean {
  const handlers = asRecord(server)?._requestHandlers
  return handlers instanceof Map && typeof handlers.get === 'function'
}

/** `getClientVersion()` — still present on v2, and a link in B1's identity chain. */
export function hasClientVersionAccessor(server: unknown): boolean {
  return hasMethod(server, 'getClientVersion')
}

/**
 * `getNegotiatedProtocolVersion()` — v2 only, and the last link in the protocol
 * version chain. A v1 server does not have it, which is why the chain probes for
 * it instead of branching on which SDK is installed.
 */
export function hasNegotiatedProtocolVersionAccessor(server: unknown): boolean {
  return hasMethod(server, 'getNegotiatedProtocolVersion')
}

/** `_serverInfo`, which names the server on every event. */
export function hasServerInfo(server: unknown): boolean {
  const info = asRecord(asRecord(server)?._serverInfo)
  return !!info && 'name' in info
}
