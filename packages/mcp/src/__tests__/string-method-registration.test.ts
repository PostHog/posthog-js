import { ListToolsRequestSchema, PingRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrument } from '../index'
import type { CompatibleRequestHandlerExtra, MCPRequestLike, MCPServerLike } from '../types'
import { EventCapture, fakePostHog } from './test-utils'

/**
 * Coverage for the two things MCP SDK v2 changed about `setRequestHandler`, both
 * of which our patch used to get wrong:
 *
 * 1. **The first argument is a method string, not a Zod schema.** v1 carries the
 *    method as a literal on the request schema's shape; v2 passes the string.
 *    A registration we cannot name is one we cannot wrap, so a handler bound
 *    after `instrument()` silently *replaced* the analytics wrapper — the exact
 *    shape `@rekog/mcp-nest` produces (#4449), where handlers are attached in a
 *    `serverMutator` hook after instrumentation.
 * 2. **There is a three-argument form.** `setRequestHandler(method, { params,
 *    result }, handler)` registers a custom method. The old two-parameter
 *    wrapper dropped the third argument, so the SDK saw the schemas object where
 *    the handler belongs and threw `setRequestHandler: handler is required` —
 *    breaking the *host's* server, not just our instrumentation.
 *
 * The double below reproduces v2's `Protocol.setRequestHandler` semantics
 * (`@modelcontextprotocol/server@2.0.0`, `src`'s `setRequestHandler`) rather
 * than importing it: v2 is not a dependency of this package, and what is under
 * test is our wrapper's contract with those semantics. The end-to-end run
 * against the real v2 SDK lives in the dual-era testbed.
 */

interface V2Schemas {
  params: { parse(value: unknown): unknown }
  result?: unknown
}

type V2Handler = (request: unknown, ctx: unknown) => unknown

/** Spec methods v2 accepts in the two-argument form; everything else needs schemas. */
const SPEC_METHODS = new Set(['initialize', 'ping', 'tools/list', 'tools/call'])

class V2ServerDouble {
  _requestHandlers = new Map<string, (request: MCPRequestLike, extra?: CompatibleRequestHandlerExtra) => Promise<any>>()
  _serverInfo = { name: 'v2-double', version: '1.0.0' }

  getClientVersion(): { name: string; version: string } {
    return { name: 'test client', version: '1.0' }
  }

  // Mirrors v2's overloads: (method, handler) for spec methods, and
  // (method, schemas, handler) for custom ones.
  setRequestHandler(method: unknown, schemasOrHandler?: V2Schemas | V2Handler, maybeHandler?: V2Handler): void {
    if (typeof method !== 'string') {
      throw new TypeError(`'${String(method)}' is not a spec request method`)
    }
    let stored: V2Handler
    if (typeof schemasOrHandler === 'function') {
      if (!SPEC_METHODS.has(method)) {
        throw new TypeError(`'${method}' is not a spec request method; pass schemas as the second argument.`)
      }
      stored = schemasOrHandler
    } else if (maybeHandler) {
      const schemas = schemasOrHandler as V2Schemas
      stored = (request, ctx) => maybeHandler(schemas.params.parse((request as MCPRequestLike).params), ctx)
    } else {
      throw new TypeError('setRequestHandler: handler is required')
    }
    this._requestHandlers.set(method, stored as (request: MCPRequestLike) => Promise<any>)
  }
}

function makeServer(): MCPServerLike {
  return new V2ServerDouble() as unknown as MCPServerLike
}

/** Dispatches through the handler map, the way the SDK's request loop does. */
function dispatch(server: MCPServerLike, request: MCPRequestLike, extra?: CompatibleRequestHandlerExtra) {
  const handler = server._requestHandlers.get(request.method as string)
  if (!handler) {
    throw new Error(`no handler for ${request.method}`)
  }
  return handler(request, extra)
}

const TOOLS = [
  {
    name: 'get_trends',
    description: 'Return a trends time series for an event.',
    inputSchema: { type: 'object', properties: { event: { type: 'string' } }, required: ['event'] },
  },
]

describe('setRequestHandler with string method names (MCP SDK v2)', () => {
  let eventCapture: EventCapture

  beforeEach(async () => {
    eventCapture = new EventCapture()
    await eventCapture.start()
  })

  afterEach(async () => {
    await eventCapture.stop()
  })

  it('wraps a tools/call handler registered after instrument() with a string method', async () => {
    const server = makeServer()
    instrument(server, fakePostHog(), { context: false })

    server.setRequestHandler('tools/call', (async (request: MCPRequestLike) => ({
      content: [{ type: 'text', text: `trends for ${request.params?.arguments?.event}` }],
    })) as any)

    const result = (await dispatch(server, {
      method: 'tools/call',
      params: { name: 'get_trends', arguments: { event: 'pageview' } },
    })) as { content: { text: string }[] }
    await new Promise((r) => setTimeout(r, 20))

    // The application handler still runs and its result is returned untouched.
    expect(result.content[0].text).toBe('trends for pageview')

    const toolCalls = eventCapture.findCapturesByEvent('$mcp_tool_call')
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0].properties.$mcp_tool_name).toBe('get_trends')
    expect(toolCalls[0].properties.$mcp_is_error).toBe(false)
  })

  it('wraps a tools/list handler registered after instrument() with a string method', async () => {
    const server = makeServer()
    instrument(server, fakePostHog(), { context: true })

    server.setRequestHandler('tools/list', (async () => ({ tools: TOOLS })) as any)

    const response = (await dispatch(server, { method: 'tools/list', params: {} })) as {
      tools: { name: string; inputSchema?: { properties?: Record<string, unknown> } }[]
    }
    await new Promise((r) => setTimeout(r, 20))

    // The injected `context` parameter is the user-visible proof the wrapper survived.
    expect(response.tools.find((t) => t.name === 'get_trends')?.inputSchema?.properties?.context).toBeDefined()

    const listings = eventCapture.findCapturesByEvent('$mcp_tools_list')
    expect(listings).toHaveLength(1)
    expect(listings[0].properties.$mcp_listed_tool_names).toEqual(expect.arrayContaining(['get_trends']))
  })

  it('forwards the three-argument custom-method form instead of breaking the host server', async () => {
    const server = makeServer()
    instrument(server, fakePostHog(), { context: true })

    const handler = jest.fn(async (params: unknown) => ({ echoed: params }))
    const schemas = { params: { parse: (value: unknown) => value } }

    // Before the fix this threw `setRequestHandler: handler is required`, and
    // because the SDK builds a fresh server per HTTP request the throw repeated
    // on every request — the host server returned 500 across the board.
    expect(() => (server.setRequestHandler as any)('acme/search', schemas, handler)).not.toThrow()

    const result = await dispatch(server, { method: 'acme/search', params: { query: 'trends' } } as MCPRequestLike)
    expect(handler).toHaveBeenCalledWith({ query: 'trends' }, undefined)
    expect(result).toEqual({ echoed: { query: 'trends' } })
  })

  it('does not treat an inherited Object property name as a patch', async () => {
    const server = makeServer()
    instrument(server, fakePostHog(), { context: true })

    // `patches['toString']` resolves to `Object.prototype.toString` under a bare
    // index, which a truthiness check would accept as a handler patch.
    const handler = jest.fn(async (params: unknown) => ({ ok: params }))
    expect(() =>
      (server.setRequestHandler as any)('toString', { params: { parse: (v: unknown) => v } }, handler)
    ).not.toThrow()

    const result = await dispatch(server, { method: 'toString', params: { a: 1 } } as MCPRequestLike)
    expect(result).toEqual({ ok: { a: 1 } })
  })

  it('leaves an unpatched method registered by string untouched', async () => {
    const server = makeServer()
    instrument(server, fakePostHog(), { context: true })

    const handler = (async () => ({})) as any
    server.setRequestHandler('ping', handler)

    // Not one of our patched methods, so the map holds exactly what was registered.
    expect(server._requestHandlers.get('ping')).toBe(handler)
  })
})

/**
 * The v1 registration form has to keep behaving exactly as it did — it is what
 * essentially all traffic runs on today.
 */
describe('setRequestHandler with Zod schemas (MCP SDK v1) is unchanged', () => {
  let eventCapture: EventCapture

  beforeEach(async () => {
    eventCapture = new EventCapture()
    await eventCapture.start()
  })

  afterEach(async () => {
    await eventCapture.stop()
  })

  it('still resolves the method off a v1 request schema and wraps the handler', async () => {
    // A v1-shaped double: it accepts the Zod schema and keys the map off the
    // method literal, the way `Protocol.setRequestHandler` does on v1.
    const server = makeServer()
    const v1Style = (schema: any, handler: any) => {
      const method = schema.shape.method.value
      server._requestHandlers.set(method, handler)
    }
    ;(server as any).setRequestHandler = v1Style

    instrument(server, fakePostHog(), { context: true })
    server.setRequestHandler(ListToolsRequestSchema, (async () => ({ tools: TOOLS })) as any)

    const response = (await dispatch(server, { method: 'tools/list', params: {} })) as {
      tools: { name: string; inputSchema?: { properties?: Record<string, unknown> } }[]
    }
    await new Promise((r) => setTimeout(r, 20))

    expect(response.tools.find((t) => t.name === 'get_trends')?.inputSchema?.properties?.context).toBeDefined()
    expect(eventCapture.findCapturesByEvent('$mcp_tools_list')).toHaveLength(1)
  })

  it('leaves an unpatched v1 schema registration untouched', async () => {
    const server = makeServer()
    const v1Style = (schema: any, handler: any) => {
      const method = schema.shape.method.value
      server._requestHandlers.set(method, handler)
    }
    ;(server as any).setRequestHandler = v1Style

    instrument(server, fakePostHog(), { context: true })
    const handler = (async () => ({})) as any
    server.setRequestHandler(PingRequestSchema, handler)

    expect(server._requestHandlers.get('ping')).toBe(handler)
  })
})
