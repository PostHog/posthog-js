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

  /**
   * `enableConversationId` appends a `[SERVER]: Reuse conversation_id=…` block to
   * the result so the agent echoes the handle back. On v2 a thrown error is
   * already flattened into an `isError` result by the time we see it, so that
   * result *is* our only description of the failure — and reading the error off
   * the delivered copy would splice a fresh uuid into `$mcp_error_message`,
   * turning one recurring failure into a new error group on every call.
   *
   * The agent must still receive the prompt-back on a failed call: a tool that
   * fails on the first call of a conversation is exactly when the handle matters,
   * or the retry starts a new conversation and the failure and its fix land in
   * different sessions. So both halves are asserted here — clean message out to
   * PostHog, handle still delivered to the caller.
   */
  it('keeps the conversation prompt-back out of the captured error message', async () => {
    const server = makeV2Server()
    instrument(server, fakePostHog(), { context: false, enableConversationId: true })

    const result = await dispatch(
      server,
      { method: 'tools/call', params: { name: 'fail_always', arguments: {} } },
      v2Ctx()
    )
    await new Promise((r) => setTimeout(r, 20))

    const call = eventCapture.findCapturesByEvent('$mcp_tool_call')[0]
    expect(call.properties.$mcp_is_error).toBe(true)
    expect(call.properties.$mcp_error_message).toBe('intentional failure')
    expect(call.properties.$mcp_error_message).not.toMatch(/conversation_id/)

    // The caller still gets the handle, on the failed call.
    const delivered = (result.content as { text: string }[]).map((block) => block.text).join('\n')
    expect(delivered).toMatch(/Reuse conversation_id=/)
  })

  /**
   * The one thing the stale executor does cost us, measured: v2 flattens a throw
   * into an `isError` result before our callback wrapper would have stashed the
   * original error, and the wrapper never runs anyway because dispatch goes
   * through the executor. So the error's **class** is lost — everything else
   * survives, because the `tools/call` request-handler patch sees the result.
   *
   * This is a documented limitation, not an aspiration: if wrapping the executor
   * ever lands, this test should start failing and be updated to expect the real
   * class name.
   */
  it('captures message and error flag but degrades the error class to Error', async () => {
    const server = makeV2Server()
    class RateLimitError extends Error {}
    ;(server as unknown as V2McpServerDouble).registerTool(
      'rate_limited',
      { description: 'Throws a subclass.' },
      async () => {
        throw new RateLimitError('rate limited')
      }
    )
    instrument(server, fakePostHog(), { context: false })

    await dispatch(server, { method: 'tools/call', params: { name: 'rate_limited', arguments: {} } }, v2Ctx())
    await new Promise((r) => setTimeout(r, 20))

    const call = eventCapture.findCapturesByEvent('$mcp_tool_call')[0]
    expect(call.properties.$mcp_is_error).toBe(true)
    expect(call.properties.$mcp_error_message).toBe('rate limited')
    // Not 'RateLimitError' — the class does not survive v2's flattening.
    expect(call.properties.$mcp_error_type).toBe('Error')

    const exceptionList = eventCapture.findCapturesByEvent('$exception')[0].properties.$exception_list as {
      type: string
      value: string
    }[]
    expect(exceptionList[0]).toEqual(expect.objectContaining({ type: 'Error', value: 'rate limited' }))
  })

  /**
   * v2 builds a tool's `executor` from its `handler` **once at registration**,
   * and dispatch calls the executor — so our callback wrapper, installed after
   * registration, never runs on v2. The stripping of SDK-injected arguments does
   * not depend on it: the `tools/call` request-handler patch strips them before
   * the SDK ever dispatches, and the callback wrapper is a defensive second pass
   * for hosts that invoke a tool callback directly. This asserts the primary
   * path, which is what a real v2 server takes.
   */
  it('strips the injected context argument before the tool runs, despite the stale executor', async () => {
    const server = makeV2Server()
    const seen: unknown[] = []
    ;(server as unknown as V2McpServerDouble).registerTool(
      'watch_args',
      {
        description: 'Records the arguments it was called with.',
        inputSchema: { type: 'object', properties: { event: { type: 'string' } } },
      },
      async (args: unknown) => {
        seen.push(args)
        return { content: [{ type: 'text', text: 'ok' }] }
      }
    )

    instrument(server, fakePostHog(), { context: true })

    await dispatch(
      server,
      {
        method: 'tools/call',
        params: { name: 'watch_args', arguments: { event: 'pageview', context: 'user asked for trends' } },
      },
      v2Ctx()
    )
    await new Promise((r) => setTimeout(r, 20))

    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual({ event: 'pageview' })
    expect(eventCapture.findCapturesByEvent('$mcp_tool_call')[0].properties.$mcp_intent).toBe('user asked for trends')
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
