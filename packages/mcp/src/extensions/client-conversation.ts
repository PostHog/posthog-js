import type { CompatibleRequestHandlerExtra, MCPRequestLike } from '../types'
import { resolveClientIdentity } from './client-identity'
import { readHeaderValue } from './headers'
import { deterministicPrefixedId } from './ids'
import { getRequestHeaders } from './request-headers'
import { decodeSessionId, readMcpSessionHeader } from './session-token'
import { CLIENT_USER_AGENT_HEADER } from './transport-identity'

/**
 * Client conversation ids: a value an MCP client puts in a `tools/call`
 * request's `_meta` to name the conversation the call belongs to. This is the
 * table of the spec's "Session identity" requirement, row for row. A row's key is
 * read only from a request its recognition rule matches, so a generic key such as
 * Codex's `sessionId` is never read from a client that means something else by it.
 */
export interface ClientConversationRow {
  key: string
  /** Normalizes a valid value, or returns undefined for one that is not this row's shape. */
  readValue: (value: unknown) => string | undefined
  recognizes: (client: RequestClientSignals) => boolean
  /**
   * The client sends its id on every call, so the SDK advertises no
   * `conversation_id` to it and mints it no handle. Rows whose clients have
   * versions or kinds of conversation that send no id keep the handle.
   */
  handleFree: boolean
}

/** What recognizes a request's client: the HTTP `User-Agent` and the resolved client name. */
export interface RequestClientSignals {
  userAgent?: string
  clientName?: string
}

export interface ClientConversation {
  key: string
  id: string
}

const PRINTABLE_ASCII_UP_TO_128 = /^[\x20-\x7e]{1,128}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const NIL_UUID = '00000000-0000-0000-0000-000000000000'
const CHATGPT_USER_AGENT = /^openai-mcp\/[^\s(]*\s*\(\s*chatgpt\s*[;,)]/i

function readPrintableAscii(value: unknown): string | undefined {
  return typeof value === 'string' && PRINTABLE_ASCII_UP_TO_128.test(value) ? value : undefined
}

function readUuid(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const lowered = value.toLowerCase()
  return UUID.test(lowered) && lowered !== NIL_UUID ? lowered : undefined
}

function userAgentStartsWith(client: RequestClientSignals, prefixes: string[]): boolean {
  const userAgent = client.userAgent?.toLowerCase()
  return userAgent !== undefined && prefixes.some((prefix) => userAgent.startsWith(prefix.toLowerCase()))
}

function clientNameIs(client: RequestClientSignals, names: string[]): boolean {
  const clientName = client.clientName?.toLowerCase()
  return clientName !== undefined && names.some((name) => name.toLowerCase() === clientName)
}

const VSCODE_PRODUCT_NAMES = ['Visual Studio Code', 'Visual Studio Code - Insiders']

/** Checked in this order; the first row that recognizes a request is its client's row. */
export const CLIENT_CONVERSATION_ROWS: readonly ClientConversationRow[] = [
  {
    key: 'openai/session',
    readValue: readPrintableAscii,
    recognizes: (client) => client.userAgent !== undefined && CHATGPT_USER_AGENT.test(client.userAgent),
    handleFree: true,
  },
  {
    key: 'sessionId',
    readValue: readUuid,
    recognizes: (client) =>
      userAgentStartsWith(client, ['codex-mcp-client/']) || clientNameIs(client, ['codex-mcp-client']),
    handleFree: false,
  },
  {
    key: 'vscode.conversationId',
    readValue: readUuid,
    recognizes: (client) =>
      userAgentStartsWith(
        client,
        VSCODE_PRODUCT_NAMES.map((name) => `${name}/`)
      ) || clientNameIs(client, VSCODE_PRODUCT_NAMES),
    handleFree: false,
  },
]

export function recognizeClient(client: RequestClientSignals): ClientConversationRow | undefined {
  return CLIENT_CONVERSATION_ROWS.find((row) => row.recognizes(client))
}

/**
 * The client name follows "Client and server identity": the request's own
 * `_meta` first, then a replayed session token's `cn`, then a handshake bound to
 * the request's transport session.
 */
export function readClientSignals(
  headers: unknown,
  requestClientName: string | undefined,
  handshakeClientName: string | undefined
): RequestClientSignals {
  return {
    userAgent: readHeaderValue(headers, CLIENT_USER_AGENT_HEADER),
    clientName: requestClientName ?? decodeSessionId(readMcpSessionHeader(headers))?.clientName ?? handshakeClientName,
  }
}

export function readRequestClientSignals(
  request: MCPRequestLike,
  extra?: CompatibleRequestHandlerExtra,
  server?: unknown
): RequestClientSignals {
  return readClientSignals(
    getRequestHeaders(extra),
    resolveClientIdentity({ request, extra })?.clientName,
    resolveClientIdentity({ request, extra, server })?.clientName
  )
}

/** A tool call's recognized client, and the conversation id it named if any. */
export interface RequestClient {
  row?: ClientConversationRow
  conversation?: ClientConversation
}

export function resolveRequestClient(
  request: MCPRequestLike,
  extra?: CompatibleRequestHandlerExtra,
  server?: unknown
): RequestClient {
  const row = recognizeClient(readRequestClientSignals(request, extra, server))
  return { row, conversation: readClientConversation(row, request.params?._meta) }
}

/** The recognized client's conversation id in `meta`, or undefined when there is none or it is not the row's shape. */
export function readClientConversation(
  row: ClientConversationRow | undefined,
  meta: unknown
): ClientConversation | undefined {
  if (!row || !meta || typeof meta !== 'object') {
    return undefined
  }
  const id = row.readValue((meta as Record<string, unknown>)[row.key])
  return id === undefined ? undefined : { key: row.key, id }
}

/**
 * Keyed so two clients' ids, or a client id and a conversation handle, never
 * share a hash input. Part of the cross-SDK contract: posthog-python derives the
 * same id from the same input.
 */
export function deriveSessionIdFromClientConversation({ key, id }: ClientConversation): string {
  return deterministicPrefixedId('ses', `${key}:${id}`)
}
