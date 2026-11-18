import { isModernEraRequest, newSessionId } from './session'
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
    // A 2026-era request must never be answered with a session id.
    if (body?.method !== 'initialize' || isModernEraRequest(body as Parameters<typeof isModernEraRequest>[0])) {
      return handler(request, ...args)
    }
    const token = encodeSessionId({
      sessionId: newSessionId(),
      clientName: asString(body.params?.clientInfo?.name),
      clientVersion: asString(body.params?.clientInfo?.version),
      protocolVersion: asString(body.params?.protocolVersion),
    })
    const response = await handler(withHeader(request, token), ...args)
    // A stateful handler issues its own session id, which the client must replay.
    if (!response.ok || response.headers.has(MCP_SESSION_HEADER)) {
      return response
    }
    const headers = new Headers(response.headers)
    headers.set(MCP_SESSION_HEADER, token)
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  }
}

// An `initialize` is a few hundred bytes; reading more would let any caller make
// the wrapper buffer a large body before the handler can reject it.
const MAX_INITIALIZE_BYTES = 64 * 1024

// A 2025-era client sends no session until `initialize` has answered, and a
// 2026-era client never sends `initialize`. Anything else skips the body read.
function mayBeInitialize(request: Request): boolean {
  return (
    request.method === 'POST' &&
    !request.headers.has(MCP_SESSION_HEADER) &&
    !request.headers.has('mcp-method') &&
    Number(request.headers.get('content-length') ?? 0) <= MAX_INITIALIZE_BYTES
  )
}

async function readJson(request: Request): Promise<InitializeRequest | undefined> {
  if (request.signal.aborted) {
    return undefined
  }
  const reader = request.clone().body?.getReader()
  if (!reader) {
    return undefined
  }
  // A tee branch's cancel settles only once the handler's branch ends too.
  const stop = () => void reader.cancel().catch(() => undefined)
  request.signal.addEventListener('abort', stop, { once: true })
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      size += chunk.value.byteLength
      if (size > MAX_INITIALIZE_BYTES) {
        stop()
        return undefined
      }
      chunks.push(chunk.value)
    }
    const bytes = new Uint8Array(size)
    chunks.reduce((offset, part) => (bytes.set(part, offset), offset + part.byteLength), 0)
    return JSON.parse(new TextDecoder().decode(bytes)) as InitializeRequest
  } catch {
    return undefined
  } finally {
    request.signal.removeEventListener('abort', stop)
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
    // Own string keys only: a runtime's request internals can be enumerable symbols.
    const copy = new Request(request, { headers })
    for (const key of Object.keys(request)) {
      Reflect.set(copy, key, Reflect.get(request, key))
    }
    return copy
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
