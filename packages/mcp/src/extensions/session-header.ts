import { newSessionId } from './session'
import { MCP_SESSION_HEADER, encodeSessionId } from './session-token'

type FetchHandler<A extends unknown[]> = (request: Request, ...args: A) => Response | Promise<Response>

interface InitializeRequest {
  method?: unknown
  params?: { protocolVersion?: unknown; clientInfo?: { name?: unknown; version?: unknown } }
}

/**
 * Wraps a fetch-style MCP handler so a stateless server keeps one session per
 * client on the 2025 protocol, where client identity is sent only at
 * `initialize`. Handlers that stream that response, such as `mcp-handler` and
 * the SDK v2 `createMcpHandler`, send headers before `instrument()` can add the
 * session token, so the token is minted here, handed to the handler on the
 * `initialize` request, and returned on its response for the client to replay.
 */
export function withMcpSessionHeader<A extends unknown[]>(handler: FetchHandler<A>): FetchHandler<A> {
  return async (request, ...args) => {
    const body = mayBeInitialize(request) ? await readJson(request) : undefined
    if (body?.method !== 'initialize') {
      return handler(request, ...args)
    }
    const token = encodeSessionId({
      sessionId: newSessionId(),
      clientName: asString(body.params?.clientInfo?.name),
      clientVersion: asString(body.params?.clientInfo?.version),
      protocolVersion: asString(body.params?.protocolVersion),
    })
    const response = await handler(withHeader(request, token), ...args)
    if (!response.ok) {
      return response
    }
    const headers = new Headers(response.headers)
    headers.set(MCP_SESSION_HEADER, token)
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  }
}

// A 2025-era client sends neither header until `initialize` has answered, and
// a 2026-era client never sends `initialize`. Anything else skips the body read.
function mayBeInitialize(request: Request): boolean {
  return (
    request.method === 'POST' &&
    !request.headers.has(MCP_SESSION_HEADER) &&
    !request.headers.has('mcp-protocol-version') &&
    !request.headers.has('mcp-method')
  )
}

async function readJson(request: Request): Promise<InitializeRequest | undefined> {
  try {
    return (await request.clone().json()) as InitializeRequest
  } catch {
    return undefined
  }
}

// Edits the request in place so whatever an auth wrapper attached to it
// survives. A request with immutable headers gets a copy carrying those fields.
function withHeader(request: Request, token: string): Request {
  try {
    request.headers.set(MCP_SESSION_HEADER, token)
    return request
  } catch {
    const headers = new Headers(request.headers)
    headers.set(MCP_SESSION_HEADER, token)
    return Object.assign(new Request(request, { headers }), request)
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
