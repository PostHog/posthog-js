import { InMemoryTransport, createMcpHandler } from '@modelcontextprotocol/server'

/**
 * Drives an MCP SDK v2 server over a linked in-memory transport by speaking raw
 * JSON-RPC, rather than through a v2 `Client`.
 *
 * The point of these tests is what the *server* hands our instrumentation, so
 * the dispatch has to be the SDK's own — a hand-built `extra` would be exactly
 * the v1-shaped fiction the code under test already assumes. Talking wire-level
 * gets that for the price of one dependency instead of two, and keeps the v2
 * client out of a package that must never import an SDK at runtime.
 */
export interface V2Session {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>
  close(): Promise<void>
}

interface JsonRpcResponse {
  id?: number
  result?: unknown
  error?: { message?: string }
}

type ConnectableServer = { connect(transport: unknown): Promise<void> }

export async function connectV2Server(server: ConnectableServer): Promise<V2Session> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const pending = new Map<number, (response: JsonRpcResponse) => void>()
  let nextId = 1

  clientTransport.onmessage = (message: JsonRpcResponse) => {
    if (typeof message.id !== 'number') {
      return // a notification — nothing is waiting on it
    }
    pending.get(message.id)?.(message)
    pending.delete(message.id)
  }

  await Promise.all([clientTransport.start(), server.connect(serverTransport)])

  return {
    async request(method, params = {}) {
      const id = nextId++
      const response = await new Promise<JsonRpcResponse>((resolve, reject) => {
        pending.set(id, resolve)
        clientTransport
          .send({ jsonrpc: '2.0', id, method, params })
          .catch((error: unknown) => reject(error instanceof Error ? error : new Error(String(error))))
      })
      if (response.error) {
        throw new Error(response.error.message ?? 'MCP request failed')
      }
      return response.result
    },
    async close() {
      await Promise.all([clientTransport.close(), serverTransport.close()])
    },
  }
}

export const INITIALIZE_PARAMS = {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'v2 test client', version: '3.2.1' },
}

/**
 * A stateless SDK v2 HTTP endpoint: `createMcpHandler` builds a fresh server per
 * request, which is the deployment shape where the `extra` differences actually
 * bite — no connection to remember anything on, so every request has to carry
 * its own identity in headers.
 */
export function serveV2Http(
  buildServer: () => unknown
): (body: Record<string, unknown>, headers?: Record<string, string>) => Promise<Response> {
  const handler = createMcpHandler(() => buildServer() as never)
  return (body, headers = {}) =>
    handler.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...headers,
        },
        body: JSON.stringify(body),
      })
    )
}

export const rpc = (id: number, method: string, params: Record<string, unknown> = {}) => ({
  jsonrpc: '2.0',
  id,
  method,
  params,
})
