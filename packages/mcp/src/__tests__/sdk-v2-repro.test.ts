import { McpServer, Server } from '@modelcontextprotocol/server'
import { z } from 'zod4'
import { instrument } from '../index'
import { EventCapture, fakePostHog } from './test-utils'
import { MCP_SESSION_HEADER, encodeSessionId } from '../extensions/session-token'
import { connectV2Server, INITIALIZE_PARAMS, rpc, serveV2Http } from './test-utils/v2-server-factory'

const TOOLS = [{ name: 'plan', description: 'plans things', inputSchema: { type: 'object', properties: {} } }]

/**
 * A per-request server built the way an SDK v2 framework builds one: the
 * factory hands `instrument()` a bare server and only then binds the handlers,
 * by string method name.
 */
function buildStatelessServer(): Server {
  const server = new Server({ name: 'v2 stateless', version: '1.0.0' }, { capabilities: { tools: {} } })
  instrument(server as never, fakePostHog(), { context: { description: 'why' } })
  server.setRequestHandler('tools/list', (async () => ({ tools: TOOLS })) as never)
  server.setRequestHandler('tools/call', (async () => ({ content: [{ type: 'text', text: 'ok' }] })) as never)
  return server
}

describe('MCP SDK v2 support (#4449)', () => {
  let eventCapture: EventCapture

  beforeEach(async () => {
    eventCapture = new EventCapture()
    await eventCapture.start()
  })

  afterEach(async () => {
    await eventCapture.stop()
  })

  it('accepts a high-level McpServer, which has registerTool but no tool', () => {
    const logger = jest.fn()
    const server = new McpServer({ name: 'v2', version: '1.0.0' }, { capabilities: { tools: {} } })

    instrument(server, fakePostHog(), { logger })

    expect(logger.mock.calls.flat().join('\n')).not.toContain('compatibility error')
  })

  it('wraps handlers registered after instrument() with a string method name', async () => {
    const server = buildStatelessServer()

    const session = await connectV2Server(server)
    try {
      await session.request('initialize', INITIALIZE_PARAMS)
      await session.request('tools/call', { name: 'plan', arguments: {} })
    } finally {
      await session.close()
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
    const toolCalls = eventCapture.findCapturesByEvent('$mcp_tool_call')
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0].properties.$mcp_resource_name).toBe('plan')
  })

  /**
   * v2 takes `(method, {params, result}, handler)` for a custom method. Our
   * patched setter used to be a two-parameter arrow, so it handed the SDK the
   * schemas object where the handler belonged and the registration threw.
   */
  it('leaves the three-argument registration form working', async () => {
    const schemas = { params: z.object({}), result: z.object({ ok: z.boolean() }) }
    const server = new Server({ name: 'v2 custom', version: '1.0.0' }, { capabilities: {} })
    instrument(server, fakePostHog())

    expect(() =>
      server.setRequestHandler('acme/search', schemas as never, (async () => ({ ok: true })) as never)
    ).not.toThrow()

    const session = await connectV2Server(server)
    try {
      await session.request('initialize', INITIALIZE_PARAMS)
      expect(await session.request('acme/search')).toEqual({ ok: true })
    } finally {
      await session.close()
    }
  })

  /**
   * Ownership of the injected `context` argument is per-instance, so an instance
   * that never served a listing must not guess: a wrong guess *deletes* an
   * argument the tool declared. Guards the regression a shared, name-keyed cache
   * introduced — see the comment in `getActiveAnalyticsParameterOwnership`.
   */
  it('never strips an argument on the word of a same-named server', async () => {
    const declaresContext = [
      {
        name: 'plan',
        description: 'declares its own context',
        inputSchema: { type: 'object', properties: { context: { type: 'string' } }, required: ['context'] },
      },
    ]
    const seen: unknown[] = []

    // A same-named instance whose `plan` does NOT declare `context` lists first.
    const advertising = buildStatelessServer()
    const listSession = await connectV2Server(advertising)
    try {
      await listSession.request('initialize', INITIALIZE_PARAMS)
      await listSession.request('tools/list')
    } finally {
      await listSession.close()
    }

    const calling = new Server({ name: 'v2 stateless', version: '1.0.0' }, { capabilities: { tools: {} } })
    instrument(calling, fakePostHog(), { context: { description: 'why' } })
    calling.setRequestHandler('tools/list', (async () => ({ tools: declaresContext })) as never)
    calling.setRequestHandler('tools/call', (async (request: { params?: { arguments?: unknown } }) => {
      seen.push(request.params?.arguments)
      return { content: [{ type: 'text', text: 'ok' }] }
    }) as never)

    const callSession = await connectV2Server(calling)
    try {
      await callSession.request('initialize', INITIALIZE_PARAMS)
      await callSession.request('tools/call', { name: 'plan', arguments: { context: 'the tool requires this' } })
    } finally {
      await callSession.close()
    }

    expect(seen).toEqual([{ context: 'the tool requires this' }])
  })
})

describe('MCP SDK v2 stateless HTTP — reading request headers (#4449)', () => {
  let eventCapture: EventCapture

  beforeEach(async () => {
    eventCapture = new EventCapture()
    await eventCapture.start()
  })

  afterEach(async () => {
    await eventCapture.stop()
  })

  /**
   * Covers the READ half only. Minting the token needs response headers built
   * after the handler runs, which v2's `createMcpHandler` legacy leg does not do
   * — so the token here is pre-minted, exactly as an SSE-era server would set it
   * at the HTTP layer with the exported `encodeSessionId`.
   */
  it('recovers the session and client identity a replayed token carries', async () => {
    const post = serveV2Http(() => {
      const server = new Server({ name: 'v2 http', version: '1.0.0' }, { capabilities: { tools: {} } })
      instrument(server, fakePostHog())
      server.setRequestHandler('tools/list', (async () => ({ tools: TOOLS })) as never)
      server.setRequestHandler('tools/call', (async () => ({ content: [{ type: 'text', text: 'ok' }] })) as never)
      return server
    })

    // Every request gets its own server instance, so the only thing tying them
    // together is the token on the header — which v2 exposes nowhere v1 looked.
    const token = encodeSessionId({
      sessionId: 'ses_v2_stateless',
      clientName: 'claude-code',
      clientVersion: '4.5.0',
      protocolVersion: '2025-06-18',
    })
    const headers = { [MCP_SESSION_HEADER]: token }

    await post(rpc(1, 'initialize', INITIALIZE_PARAMS), headers)
    await post(rpc(2, 'tools/list'), headers)
    const response = await post(rpc(3, 'tools/call', { name: 'plan', arguments: {} }), headers)
    expect(response.status).toBe(200)

    await new Promise((resolve) => setTimeout(resolve, 100))
    const toolCall = eventCapture.findCapturesByEvent('$mcp_tool_call')[0]
    expect(toolCall?.properties.$session_id).toBe('ses_v2_stateless')
    expect(toolCall?.properties.$mcp_client_name).toBe('claude-code')
    expect(toolCall?.properties.$mcp_client_version).toBe('4.5.0')
  })
})

/**
 * The 2026-07-28 revision removes protocol-level sessions outright: no
 * `initialize` handshake, and servers on that revision "ignore [an
 * `Mcp-Session-Id` header], and do not mint or echo session IDs". Identity
 * instead rides `_meta` on every request.
 */
describe('MCP SDK v2 — 2026-07-28 modern era', () => {
  let eventCapture: EventCapture

  beforeEach(async () => {
    eventCapture = new EventCapture()
    await eventCapture.start()
  })

  afterEach(async () => {
    await eventCapture.stop()
  })

  const MODERN_META = {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientCapabilities': {},
    'io.modelcontextprotocol/clientInfo': { name: 'modern-client', version: '7.0.0' },
  }

  const postModernToolCall = () => {
    const post = serveV2Http(() => {
      const server = new Server({ name: 'modern', version: '1.0.0' }, { capabilities: { tools: {} } })
      instrument(server, fakePostHog())
      server.setRequestHandler('tools/list', (async () => ({ tools: TOOLS })) as never)
      server.setRequestHandler('tools/call', (async () => ({ content: [{ type: 'text', text: 'ok' }] })) as never)
      return server
    })
    return post(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'plan', arguments: {}, _meta: MODERN_META } },
      { 'Mcp-Method': 'tools/call', 'Mcp-Name': 'plan' }
    )
  }

  it('never mints a session id header on a revision that removed them', async () => {
    const response = await postModernToolCall()

    expect(response.status).toBe(200)
    expect(response.headers.get('mcp-session-id')).toBeNull()
    // Not vacuous: the instrumentation really did run on this request.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(eventCapture.findCapturesByEvent('$mcp_tool_call')).toHaveLength(1)
  })

  it('still reports the client on a request that never sent an initialize', async () => {
    await postModernToolCall()

    await new Promise((resolve) => setTimeout(resolve, 100))
    const toolCall = eventCapture.findCapturesByEvent('$mcp_tool_call')[0]
    expect(toolCall?.properties.$mcp_client_name).toBe('modern-client')
    expect(toolCall?.properties.$mcp_client_version).toBe('7.0.0')
  })
})
