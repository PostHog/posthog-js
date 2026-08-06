import { McpServer, Server } from '@modelcontextprotocol/server'
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

    instrument(server as never, fakePostHog(), { logger })

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

  it('records the injected context argument as intent on an instance that never listed', async () => {
    // The listing and the call land on different instances, which is the whole
    // point of a per-request server — and why the calling instance cannot learn
    // on its own that `context` is an argument we injected rather than the
    // tool's own.
    const advertising = buildStatelessServer()
    const listSession = await connectV2Server(advertising)
    try {
      await listSession.request('initialize', INITIALIZE_PARAMS)
      await listSession.request('tools/list')
    } finally {
      await listSession.close()
    }

    const calling = buildStatelessServer()
    const callSession = await connectV2Server(calling)
    try {
      await callSession.request('initialize', INITIALIZE_PARAMS)
      await callSession.request('tools/call', { name: 'plan', arguments: { context: 'ship the thing' } })
    } finally {
      await callSession.close()
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
    const toolCalls = eventCapture.findCapturesByEvent('$mcp_tool_call')
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0].properties.$mcp_intent).toBe('ship the thing')
  })

  it('strips the injected context argument before the tool on an instance that never listed', async () => {
    const seen: unknown[] = []
    const advertising = buildStatelessServer()
    const listSession = await connectV2Server(advertising)
    try {
      await listSession.request('initialize', INITIALIZE_PARAMS)
      await listSession.request('tools/list')
    } finally {
      await listSession.close()
    }

    const calling = new Server({ name: 'v2 stateless', version: '1.0.0' }, { capabilities: { tools: {} } })
    instrument(calling as never, fakePostHog(), { context: { description: 'why' } })
    calling.setRequestHandler('tools/list', (async () => ({ tools: TOOLS })) as never)
    calling.setRequestHandler('tools/call', (async (request: { params?: { arguments?: unknown } }) => {
      seen.push(request.params?.arguments)
      return { content: [{ type: 'text', text: 'ok' }] }
    }) as never)

    const callSession = await connectV2Server(calling)
    try {
      await callSession.request('initialize', INITIALIZE_PARAMS)
      await callSession.request('tools/call', { name: 'plan', arguments: { context: 'ship it', text: 'hi' } })
    } finally {
      await callSession.close()
    }

    expect(seen).toEqual([{ text: 'hi' }])
  })
})

describe('MCP SDK v2 stateless HTTP — request headers (#4449)', () => {
  let eventCapture: EventCapture

  beforeEach(async () => {
    eventCapture = new EventCapture()
    await eventCapture.start()
  })

  afterEach(async () => {
    await eventCapture.stop()
  })

  it('recovers the session and client identity a replayed token carries', async () => {
    const post = serveV2Http(() => {
      const server = new Server({ name: 'v2 http', version: '1.0.0' }, { capabilities: { tools: {} } })
      instrument(server as never, fakePostHog())
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
