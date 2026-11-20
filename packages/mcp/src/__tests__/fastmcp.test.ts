import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, CallToolResultSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { getRequestHeaders, instrumentFastMCP } from '../index'
import { EventCapture, fakePostHog } from './test-utils'

/**
 * FastMCP's session as far as the SDK relies on it: a low-level server built per
 * session with its handlers registered up front, exposed as `server`, and a
 * `connect` that, like FastMCP's, only returns once the client has initialized.
 */
class FakeFastMCPSession {
  readonly #server = new Server({ name: 'fastmcp test', version: '1.0.0' }, { capabilities: { tools: {} } })

  constructor() {
    this.#server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'echo',
          description: 'Echoes the text back',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
        },
      ],
    }))
    // Validates like `z.strictObject`: an argument the tool does not declare fails the call.
    this.#server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const unknown = Object.keys(request.params.arguments ?? {}).filter((key) => key !== 'text')
      return unknown.length > 0
        ? { content: [{ type: 'text', text: `Unrecognized keys: ${unknown}` }], isError: true }
        : { content: [{ type: 'text', text: JSON.stringify(request.params.arguments) }] }
    })
  }

  get server(): Server {
    return this.#server
  }

  async connect(transport: InMemoryTransport): Promise<void> {
    const initialized = new Promise<void>((resolve) => (this.#server.oninitialized = resolve))
    await this.#server.connect(transport)
    await initialized
  }
}

type EntryPoint = 'handleRequest' | 'handlePostMessage'
type Headers = Record<string, string>
type Deliver = () => Promise<void>

/**
 * mcp-proxy's transport, where every HTTP request reaches the server through an
 * entry point that carries the Node request but passes no headers on:
 * `handleRequest` for Streamable HTTP, `handlePostMessage` for the legacy `/sse`
 * endpoint. A request can wait (an event store write) before it is dispatched.
 */
async function connectSession(
  fastmcp: { FastMCPSession: typeof FakeFastMCPSession },
  entryPoint: EntryPoint = 'handleRequest',
  headers: Headers = {}
) {
  const session = new fastmcp.FastMCPSession()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  Object.assign(serverTransport, {
    [entryPoint]: async (request: { headers: Headers; delayMs?: number }, deliver: Deliver) => {
      await new Promise((r) => setTimeout(r, request.delayMs ?? 0))
      return deliver()
    },
  })
  const server = serverTransport as unknown as Record<EntryPoint, (request: unknown, deliver: Deliver) => Promise<void>>
  let next: { headers: Headers; delayMs?: number } = { headers }
  const send = clientTransport.send.bind(clientTransport)
  clientTransport.send = (message, options) => server[entryPoint](next, () => send(message, options))

  const connected = session.connect(serverTransport)
  const client = new Client({ name: 'agent', version: '1.0' })
  await client.connect(clientTransport)
  await connected
  return {
    callEcho: (callHeaders: Headers = headers, delayMs = 0) => {
      next = { headers: callHeaders, delayMs }
      return client.callTool(
        { name: 'echo', arguments: { text: 'hi', context: 'finding a churn cohort' } },
        CallToolResultSchema
      )
    },
    close: () => client.close(),
  }
}

describe('instrumentFastMCP', () => {
  let capture: EventCapture
  let fastmcp: { FastMCPSession: typeof FakeFastMCPSession }

  beforeEach(async () => {
    capture = new EventCapture()
    await capture.start()
    fastmcp = { FastMCPSession: class extends FakeFastMCPSession {} }
  })

  afterEach(async () => {
    await capture.stop()
  })

  const captures = (event: string) => capture.findCapturesByEvent(event)
  const identifyByToken = {
    identify: async (_request: unknown, extra: unknown) => {
      const token = String(getRequestHeaders(extra)?.authorization ?? '').replace(/^Bearer /, '')
      return token ? { distinctId: `user_${token}` } : null
    },
  }

  it('instruments every session from its first call, before any tools/list', async () => {
    instrumentFastMCP(fastmcp, fakePostHog())
    const sessions = [await connectSession(fastmcp), await connectSession(fastmcp)]

    const results = await Promise.all(sessions.map((s) => s.callEcho()))

    expect(results.map((r) => (r.content as unknown[])[0])).toEqual([
      { type: 'text', text: '{"text":"hi"}' },
      { type: 'text', text: '{"text":"hi"}' },
    ])
    await vi.waitFor(() => expect(captures('$mcp_tool_call')).toHaveLength(2))
    for (const { properties } of captures('$mcp_tool_call')) {
      expect(properties.$mcp_intent).toBe('finding a churn cohort')
      expect(properties.$mcp_tool_description).toBe('Echoes the text back')
      expect(properties.$mcp_input_keys).toEqual(['text'])
    }
    expect(new Set(captures('$mcp_tool_call').map((e) => e.properties.$session_id)).size).toBe(2)
    await Promise.all(sessions.map((s) => s.close()))
  })

  it('instruments once when called twice', async () => {
    instrumentFastMCP(fastmcp, fakePostHog())
    instrumentFastMCP(fastmcp, fakePostHog())
    const session = await connectSession(fastmcp)

    await session.callEcho()

    await vi.waitFor(() => expect(captures('$mcp_tool_call')).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 50))
    expect(captures('$mcp_tool_call')).toHaveLength(1)
    await session.close()
  })

  it.each(['handleRequest', 'handlePostMessage'] as const)(
    'gives callbacks the headers of the request behind each message through %s, from initialize on',
    async (entryPoint) => {
      instrumentFastMCP(fastmcp, fakePostHog(), identifyByToken)
      const session = await connectSession(fastmcp, entryPoint, { authorization: 'Bearer abc' })

      await session.callEcho()

      await vi.waitFor(() => expect(captures('$mcp_tool_call')).toHaveLength(1))
      expect(captures('$mcp_initialize')[0]?.distinct_id).toBe('user_abc')
      expect(captures('$mcp_tool_call')[0].distinct_id).toBe('user_abc')
      await session.close()
    }
  )

  it.each(['handleRequest', 'handlePostMessage'] as const)(
    'keeps each request its own headers when requests overlap on one session through %s',
    async (entryPoint) => {
      instrumentFastMCP(fastmcp, fakePostHog(), identifyByToken)
      const session = await connectSession(fastmcp, entryPoint)

      const slow = session.callEcho({ authorization: 'Bearer alice' }, 30)
      const fast = session.callEcho({ authorization: 'Bearer bob' })
      await Promise.all([slow, fast])

      await vi.waitFor(() => expect(captures('$mcp_tool_call')).toHaveLength(2))
      expect(captures('$mcp_tool_call').map((e) => e.distinct_id)).toEqual(['user_bob', 'user_alice'])
      await session.close()
    }
  )

  it.each([
    ['nothing', undefined],
    ['a module without FastMCPSession', {}],
    ['a FastMCPSession without connect', { FastMCPSession: class {} }],
  ])('logs and leaves %s alone', (_case, module) => {
    const logger = vi.fn()

    expect(() => instrumentFastMCP(module, fakePostHog(), { logger })).not.toThrow()

    expect(logger).toHaveBeenCalledWith(expect.stringMatching(/^Warning: .*FastMCP/))
  })
})
