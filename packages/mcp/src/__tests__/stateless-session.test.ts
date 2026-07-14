import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrument } from '../index'
import { getServerTrackingData } from '../extensions/internal'
import { decodeSessionId } from '../extensions/session-token'
import type { CompatibleRequestHandlerExtra, MCPRequestLike, MCPServerLike } from '../types'
import { EventCapture, fakePostHog } from './test-utils'

/**
 * Stateless / multi-pod coverage: `initialize` mints an `Mcp-Session-Id` token,
 * and later requests — even on other pods — decode the same session and client
 * identity from it.
 *
 * Patched handlers are invoked directly with hand-crafted `extra` objects
 * (matching session-id.test.ts), which is what the SDK does after routing.
 */

const INITIALIZE_REQUEST: MCPRequestLike = {
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'Claude', version: '1.2.3' },
  },
}

/** A stateless "pod": fresh instrumented low-level Server with an echo tool. */
function createPod(podName: string): { server: Server; lowLevel: MCPServerLike } {
  const server = new Server({ name: podName, version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: {} } }],
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => ({
    content: [{ type: 'text', text: `echo: ${(request.params?.arguments as { text?: string })?.text ?? ''}` }],
  }))
  instrument(server, fakePostHog())
  return { server, lowLevel: server as unknown as MCPServerLike }
}

function setFakeTransport(server: Server, transport: unknown): void {
  ;(server as unknown as { _transport?: unknown })._transport = transport
}

async function invokeHandler(
  lowLevel: MCPServerLike,
  method: string,
  request: MCPRequestLike,
  extra?: CompatibleRequestHandlerExtra
): Promise<unknown> {
  const handler = lowLevel._requestHandlers.get(method)
  if (!handler) {
    throw new Error(`No handler registered for ${method}`)
  }
  const result = await handler(request, extra)
  // captureEvent publishes fire-and-forget; let the sink drain.
  await new Promise((resolve) => setTimeout(resolve, 25))
  return result
}

describe('Stateless session minting', () => {
  let eventCapture: EventCapture

  beforeEach(async () => {
    eventCapture = new EventCapture()
    await eventCapture.start()
  })

  afterEach(async () => {
    await eventCapture.stop()
  })

  it('mints a decodable token onto a writable transport and uses its sid for $mcp_initialize', async () => {
    const { server, lowLevel } = createPod('pod-mint')
    const transport: { sessionId?: string } = {}
    setFakeTransport(server, transport)

    await invokeHandler(lowLevel, 'initialize', INITIALIZE_REQUEST, { requestInfo: { headers: {} } })

    const decoded = decodeSessionId(transport.sessionId)
    expect(decoded).not.toBeNull()
    expect(decoded?.clientName).toBe('Claude')
    expect(decoded?.clientVersion).toBe('1.2.3')

    const data = getServerTrackingData(lowLevel)
    expect(data?.sessionSource).toBe('token')
    expect(data?.sessionId).toBe(decoded?.sessionId)

    const initEvents = eventCapture.findCapturesByEvent('$mcp_initialize')
    expect(initEvents).toHaveLength(1)
    expect(initEvents[0].properties.$session_id).toBe(decoded?.sessionId)
    expect(initEvents[0].properties.$mcp_client_name).toBe('Claude')
    expect(initEvents[0].properties.$mcp_client_version).toBe('1.2.3')
  })

  it('mints through a getter-only wrapper transport (Node StreamableHTTP shape)', async () => {
    const { server, lowLevel } = createPod('pod-wrapper')
    const inner: { sessionId?: string } = {}
    const wrapper: { _webStandardTransport: typeof inner; sessionId?: string } = { _webStandardTransport: inner }
    Object.defineProperty(wrapper, 'sessionId', { get: () => inner.sessionId, configurable: true })
    setFakeTransport(server, wrapper)

    await invokeHandler(lowLevel, 'initialize', INITIALIZE_REQUEST, { requestInfo: { headers: {} } })

    const decoded = decodeSessionId(inner.sessionId)
    expect(decoded).not.toBeNull()
    expect(getServerTrackingData(lowLevel)?.sessionId).toBe(decoded?.sessionId)
  })

  describe('mint guards', () => {
    it('does not mint without requestInfo (stdio / in-memory transports)', async () => {
      const { server, lowLevel } = createPod('pod-stdio')
      const transport: { sessionId?: string } = {}
      setFakeTransport(server, transport)

      await invokeHandler(lowLevel, 'initialize', INITIALIZE_REQUEST, undefined)

      expect(transport.sessionId).toBeUndefined()
      expect(getServerTrackingData(lowLevel)?.sessionSource).toBe('generated')
    })

    it('does not mint when the client already sent a session id header', async () => {
      const { server, lowLevel } = createPod('pod-replay')
      const transport: { sessionId?: string } = {}
      setFakeTransport(server, transport)

      await invokeHandler(lowLevel, 'initialize', INITIALIZE_REQUEST, {
        requestInfo: { headers: { 'mcp-session-id': 'client-supplied' } },
      })

      expect(transport.sessionId).toBeUndefined()
    })

    it('does not mint over a stateful transport that owns its session id', async () => {
      const { server, lowLevel } = createPod('pod-stateful')
      const transport: { sessionId?: string } = { sessionId: 'transport-owned-uuid' }
      setFakeTransport(server, transport)

      await invokeHandler(lowLevel, 'initialize', INITIALIZE_REQUEST, {
        sessionId: 'transport-owned-uuid',
        requestInfo: { headers: {} },
      })

      expect(transport.sessionId).toBe('transport-owned-uuid')
      expect(getServerTrackingData(lowLevel)?.sessionSource).toBe('mcp')
    })

    it('does not mint (and does not throw) without a transport', async () => {
      const { lowLevel } = createPod('pod-transportless')

      await invokeHandler(lowLevel, 'initialize', INITIALIZE_REQUEST, { requestInfo: { headers: {} } })

      expect(getServerTrackingData(lowLevel)?.sessionSource).toBe('generated')
    })

    it('leaves session state untouched when the transport write fails', async () => {
      const { server, lowLevel } = createPod('pod-frozen')
      setFakeTransport(server, Object.freeze({}))

      await invokeHandler(lowLevel, 'initialize', INITIALIZE_REQUEST, { requestInfo: { headers: {} } })

      const data = getServerTrackingData(lowLevel)
      expect(data?.sessionSource).toBe('generated')
    })
  })

  it('attributes a tool call on a different pod to the minted session and client (multi-pod)', async () => {
    // Pod A handles initialize and mints the token.
    const podA = createPod('pod-a')
    const transportA: { sessionId?: string } = {}
    setFakeTransport(podA.server, transportA)
    await invokeHandler(podA.lowLevel, 'initialize', INITIALIZE_REQUEST, { requestInfo: { headers: {} } })

    const token = transportA.sessionId
    const decoded = decodeSessionId(token)
    expect(decoded).not.toBeNull()

    // Pod B shares nothing with pod A — the client replays the token header.
    const podB = createPod('pod-b')
    expect(podB.lowLevel.getClientVersion()).toBeUndefined()

    await invokeHandler(
      podB.lowLevel,
      'tools/call',
      { method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' } } },
      { requestInfo: { headers: { 'mcp-session-id': token } } }
    )

    const initEvents = eventCapture.findCapturesByEvent('$mcp_initialize')
    const toolCalls = eventCapture.findCapturesByEvent('$mcp_tool_call')
    expect(initEvents).toHaveLength(1)
    expect(toolCalls).toHaveLength(1)

    // Same session across pods, client identity recovered from the token alone.
    expect(toolCalls[0].properties.$session_id).toBe(decoded?.sessionId)
    expect(toolCalls[0].properties.$session_id).toBe(initEvents[0].properties.$session_id)
    expect(toolCalls[0].properties.$mcp_client_name).toBe('Claude')
    expect(toolCalls[0].properties.$mcp_client_version).toBe('1.2.3')
  })
})
