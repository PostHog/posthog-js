import { instrument, getRequestHeaders } from '../index'
import type {
  CompatibleRequestHandlerExtra,
  HighLevelMCPServerLike,
  MCPRequestLike,
  MCPServerLike,
  RegisteredTool,
} from '../types'
import { EventCapture, fakePostHog } from './test-utils'

/**
 * MCP SDK v2's high-level `McpServer` dropped the deprecated `.tool()` and kept
 * only `registerTool()`. Our compatibility gate demanded `.tool()`, so every v2
 * high-level server was rejected — and because `instrument()` swallows
 * compatibility failures and returns a working-looking handle, it was rejected
 * *silently*: no throw, no events, a healthy-looking integration and a flat
 * dashboard (#4449).
 *
 * The doubles below reproduce v2's shapes rather than importing them, because v2
 * is not a dependency of this package (`sdk-import-boundary.test.ts` pins that)
 * and what is under test is our contract with those shapes:
 *
 * - the tool registry holds `handler`, plus an `executor` built from it **once
 *   at registration**, which is what dispatch actually calls;
 * - handlers are registered by method string on the low-level server;
 * - the per-request context carries the HTTP request at `ctx.http.req` as a
 *   WHATWG `Request`, whose headers only answer to `.get()` — where v1 put a
 *   plain object at `extra.requestInfo.headers`.
 *
 * The end-to-end run against the real v2 SDK lives in the dual-era testbed.
 */

type ToolHandler = (args: unknown, ctx: unknown) => Promise<unknown>

interface V2RegisteredTool extends RegisteredTool {
  executor: ToolHandler
}

/** v2 builds `executor` from `handler` at registration time, not per call. */
function buildExecutor(handler: ToolHandler): ToolHandler {
  return async (args, ctx) => handler(args, ctx)
}

class V2McpServerDouble {
  _registeredTools: Record<string, RegisteredTool> = {}
  server: MCPServerLike

  constructor() {
    this.server = new V2LowLevelServerDouble(() => this._registeredTools) as unknown as MCPServerLike
  }

  // Note: no `tool()`. v2 removed it.
  registerTool(name: string, config: { description?: string; inputSchema?: unknown }, handler: ToolHandler): void {
    const tool: V2RegisteredTool = {
      description: config.description,
      inputSchema: config.inputSchema,
      handler,
      executor: buildExecutor(handler),
      enabled: true,
      update: (updates: { handler?: ToolHandler }) => {
        if (updates.handler) {
          tool.handler = updates.handler
          tool.executor = buildExecutor(updates.handler)
        }
      },
    } as unknown as V2RegisteredTool
    this._registeredTools[name] = tool
  }
}

class V2LowLevelServerDouble {
  _requestHandlers = new Map<string, (request: MCPRequestLike, ctx?: CompatibleRequestHandlerExtra) => Promise<any>>()
  _serverInfo = { name: 'v2-high-level-double', version: '1.0.0' }

  constructor(private readonly getTools: () => Record<string, RegisteredTool>) {
    // The high-level server binds its own dispatchers, as v2's McpServer does.
    this._requestHandlers.set('tools/list', async () => ({
      tools: Object.entries(this.getTools()).map(([name, tool]) => ({
        name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    }))
    this._requestHandlers.set('tools/call', async (request, ctx) => {
      const name = String(request.params?.name)
      const tool = this.getTools()[name] as V2RegisteredTool | undefined
      if (!tool) {
        throw new Error(`Unknown tool: ${name}`)
      }
      // v2 dispatches through `executor`, and flattens a throw into an
      // isError result rather than letting it escape the handler.
      try {
        return await tool.executor(request.params?.arguments, ctx)
      } catch (error) {
        return { content: [{ type: 'text', text: String((error as Error).message) }], isError: true }
      }
    })
  }

  getClientVersion(): { name: string; version: string } {
    return { name: 'v2 test client', version: '2.0.0' }
  }

  setRequestHandler(method: string, handler: (request: MCPRequestLike, ctx?: unknown) => Promise<any>): void {
    this._requestHandlers.set(method, handler as any)
  }
}

function makeV2Server(): HighLevelMCPServerLike {
  const server = new V2McpServerDouble()
  server.registerTool('get_trends', { description: 'Return a trends time series.' }, async (args: any) => ({
    content: [{ type: 'text', text: `trends for ${args?.event}` }],
  }))
  server.registerTool('fail_always', { description: 'Always throws.' }, async () => {
    throw new Error('intentional failure')
  })
  return server as unknown as HighLevelMCPServerLike
}

/** v2's per-request context: the HTTP request is a WHATWG `Request` at `http.req`. */
function v2Ctx(headers: Record<string, string> = {}): CompatibleRequestHandlerExtra {
  return {
    http: { req: new Request('https://example.com/mcp', { method: 'POST', headers }) },
  } as unknown as CompatibleRequestHandlerExtra
}

function dispatch(
  server: HighLevelMCPServerLike,
  request: MCPRequestLike,
  ctx?: CompatibleRequestHandlerExtra
): Promise<any> {
  const handler = server.server._requestHandlers.get(request.method as string)
  if (!handler) {
    throw new Error(`no handler for ${request.method}`)
  }
  return handler(request, ctx as any)
}

describe('instrument() on an MCP SDK v2 high-level server', () => {
  let eventCapture: EventCapture

  beforeEach(async () => {
    eventCapture = new EventCapture()
    await eventCapture.start()
  })

  afterEach(async () => {
    await eventCapture.stop()
  })

  it('captures a tool call on a server that has registerTool() but no tool()', async () => {
    const server = makeV2Server()
    expect((server as unknown as { tool?: unknown }).tool).toBeUndefined()

    instrument(server, fakePostHog(), { context: false })

    const result = await dispatch(
      server,
      { method: 'tools/call', params: { name: 'get_trends', arguments: { event: 'pageview' } } },
      v2Ctx()
    )
    await new Promise((r) => setTimeout(r, 20))

    // The application's tool still runs and its result comes back untouched.
    expect(result.content[0].text).toBe('trends for pageview')

    const toolCalls = eventCapture.findCapturesByEvent('$mcp_tool_call')
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0].properties.$mcp_tool_name).toBe('get_trends')
    expect(toolCalls[0].properties.$mcp_is_error).toBe(false)
  })

  it('captures a failing tool call as an error', async () => {
    const server = makeV2Server()
    instrument(server, fakePostHog(), { context: false })

    await dispatch(server, { method: 'tools/call', params: { name: 'fail_always', arguments: {} } }, v2Ctx())
    await new Promise((r) => setTimeout(r, 20))

    const toolCalls = eventCapture.findCapturesByEvent('$mcp_tool_call')
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0].properties.$mcp_is_error).toBe(true)
    expect(eventCapture.findCapturesByEvent('$exception')).toHaveLength(1)
  })

  it('captures a tools/list and injects the analytics parameter into the advertised schema', async () => {
    const server = makeV2Server()
    instrument(server, fakePostHog(), { context: true })

    const response = await dispatch(server, { method: 'tools/list', params: {} }, v2Ctx())
    await new Promise((r) => setTimeout(r, 20))

    expect(response.tools.find((t: any) => t.name === 'get_trends')?.inputSchema?.properties?.context).toBeDefined()

    const listings = eventCapture.findCapturesByEvent('$mcp_tools_list')
    expect(listings).toHaveLength(1)
    expect(listings[0].properties.$mcp_listed_tool_names).toEqual(expect.arrayContaining(['get_trends']))
  })

  it('lets a host resolve identity from v2 headers through the exported getRequestHeaders', async () => {
    const server = makeV2Server()
    const seen: unknown[] = []
    const identify = jest.fn(async (_request: unknown, extra: unknown) => {
      seen.push(extra)
      const auth = getRequestHeaders(extra)?.['authorization']
      return typeof auth === 'string' ? { distinctId: auth.replace('Bearer ', '') } : null
    })

    instrument(server, fakePostHog(), { context: false, identify })

    await dispatch(
      server,
      { method: 'tools/call', params: { name: 'get_trends', arguments: { event: 'pageview' } } },
      v2Ctx({ authorization: 'Bearer user-42' })
    )
    await new Promise((r) => setTimeout(r, 20))

    expect(identify).toHaveBeenCalled()
    // The callback receives the SDK's own context, unchanged — we do not
    // synthesise a v1 `requestInfo` on top of it.
    expect((seen[0] as { http?: { req?: Request } })?.http?.req).toBeInstanceOf(Request)
    expect((seen[0] as { requestInfo?: unknown })?.requestInfo).toBeUndefined()

    const toolCalls = eventCapture.findCapturesByEvent('$mcp_tool_call')
    expect(toolCalls[0].distinct_id).toBe('user-42')
  })
})
