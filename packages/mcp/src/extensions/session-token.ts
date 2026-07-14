/**
 * Self-encoded session tokens for stateless / multi-pod MCP servers.
 *
 * A stateless server keeps nothing between requests, so every request starts a
 * new session and the client name/version (only sent at `initialize`) is lost.
 * The one value clients replay on every request is the `Mcp-Session-Id` header.
 * So at `initialize` we mint that header as a token carrying the session id and
 * client identity — any pod can read them back from the header alone.
 *
 * The token is unsigned: it holds only what the client already self-reports.
 */

export const MCP_SESSION_HEADER = 'mcp-session-id'

/** What a session token carries. */
export interface SessionTokenPayload {
  /** PostHog session id (`ses_…`) → `$session_id`. */
  sessionId: string
  /** MCP client name → `$mcp_client_name`. */
  clientName?: string
  /** MCP client version → `$mcp_client_version`. */
  clientVersion?: string
}

// On the wire the token is base64url(JSON) with shortened keys to keep the
// header small: sid = sessionId, cn = clientName, cv = clientVersion.
const MAX_TOKEN_LENGTH = 4096
const MAX_SESSION_ID_LENGTH = 128
const MAX_CLIENT_FIELD_LENGTH = 200

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/

/**
 * Encodes a session token for the `Mcp-Session-Id` response header. Also
 * exported for SSE servers, which flush headers before handlers run and so
 * must set the header themselves at the HTTP layer.
 */
export function encodeSessionId(payload: SessionTokenPayload): string {
  if (!payload || typeof payload.sessionId !== 'string' || payload.sessionId.length === 0) {
    throw new Error('encodeSessionId requires a non-empty `sessionId` (use newSessionId())')
  }
  const wire: Record<string, string> = { sid: payload.sessionId }
  if (typeof payload.clientName === 'string' && payload.clientName.length > 0) {
    wire.cn = payload.clientName.slice(0, MAX_CLIENT_FIELD_LENGTH)
  }
  if (typeof payload.clientVersion === 'string' && payload.clientVersion.length > 0) {
    wire.cv = payload.clientVersion.slice(0, MAX_CLIENT_FIELD_LENGTH)
  }
  return utf8ToBase64Url(JSON.stringify(wire))
}

/**
 * Decodes an `Mcp-Session-Id` value into a token payload. Returns `null` for
 * anything that isn't one of our tokens (transport UUIDs, JWTs, garbage) and
 * never throws.
 */
export function decodeSessionId(value: unknown): SessionTokenPayload | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TOKEN_LENGTH) {
    return null
  }
  // JWTs carry dots; UUIDs pass this check but fail JSON.parse below.
  if (!BASE64URL_PATTERN.test(value)) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(base64UrlToUtf8(value))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  const wire = parsed as Record<string, unknown>
  if (typeof wire.sid !== 'string' || wire.sid.length === 0 || wire.sid.length > MAX_SESSION_ID_LENGTH) {
    return null
  }
  const payload: SessionTokenPayload = { sessionId: wire.sid }
  // A bad cn/cv just means no client info — it does not reject the token.
  if (typeof wire.cn === 'string' && wire.cn.length > 0) {
    payload.clientName = wire.cn.slice(0, MAX_CLIENT_FIELD_LENGTH)
  }
  if (typeof wire.cv === 'string' && wire.cv.length > 0) {
    payload.clientVersion = wire.cv.slice(0, MAX_CLIENT_FIELD_LENGTH)
  }
  return payload
}

/**
 * Reads the `mcp-session-id` header off `extra.requestInfo.headers`. The SDK
 * transports lowercase header keys; the fallback scan covers hand-built extras.
 */
export function readMcpSessionHeader(headers: unknown): string | undefined {
  if (!headers || typeof headers !== 'object') {
    return undefined
  }
  const record = headers as Record<string, unknown>
  let value = record[MCP_SESSION_HEADER]
  if (value === undefined) {
    const key = Object.keys(record).find((k) => k.toLowerCase() === MCP_SESSION_HEADER)
    value = key === undefined ? undefined : record[key]
  }
  const first = Array.isArray(value) ? value[0] : value
  if (typeof first !== 'string') {
    return undefined
  }
  const trimmed = first.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Puts a minted token on the transport so it goes out as the `Mcp-Session-Id`
 * response header. The Node transport's `sessionId` is a getter backed by an
 * inner web-standard transport, so verify the write by reading back and fall
 * back to writing the inner one. Returns whether the write stuck; never throws.
 */
export function writeSessionIdToTransport(transport: unknown, token: string): boolean {
  if (!transport || typeof transport !== 'object') {
    return false
  }
  const outer = transport as { sessionId?: string; _webStandardTransport?: unknown }
  try {
    outer.sessionId = token
  } catch {
    // getter-only wrapper — try the inner transport below
  }
  if (outer.sessionId === token) {
    return true
  }
  const inner = outer._webStandardTransport
  if (inner && typeof inner === 'object') {
    try {
      ;(inner as { sessionId?: string }).sessionId = token
    } catch {
      // read-only inner transport — the final read-back decides
    }
  }
  return outer.sessionId === token
}

// base64url without assuming Node: Buffer where available, TextEncoder/btoa on
// edge runtimes. Must survive non-ASCII client names.

function utf8ToBase64Url(input: string): string {
  if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
    return Buffer.from(input, 'utf8').toString('base64url')
  }
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToUtf8(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
    return Buffer.from(padded, 'base64').toString('utf8')
  }
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}
