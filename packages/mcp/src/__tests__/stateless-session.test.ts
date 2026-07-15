import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrument } from '../index'
import { getServerTrackingData } from '../extensions/internal'
import { decodeSessionId } from '../extensions/session-token'
import type { CompatibleRequestHandlerExtra, MCPAnalyticsOptions, MCPRequestLike, MCPServerLike } from '../types'
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

/** A stateless "pod": fresh instrumented low-level Server with a get_plan tool. */
function createPod(podName: string, options?: MCPAnalyticsOptions): { server: Server; lowLevel: MCPServerLike } {
  const server = new Server({ name: podName, version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'get_plan',
        description: "Return the caller's current plan",
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  }))
  server.setRequestHandler(CallToolRequestSchema, async () => ({
    content: [{ type: 'text', text: 'plan: enterprise' }],
  }))
  instrument(server, fakePostHog(), options)
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
      { method: 'tools/call', params: { name: 'get_plan', arguments: {} } },
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

  describe('identify across stateless pods', () => {
    const IDENTITY = { distinctId: 'user_mock', properties: { email: 'mock@example.com', plan: 'enterprise' } }
    const PLAN_CALL: MCPRequestLike = { method: 'tools/call', params: { name: 'get_plan', arguments: {} } }

    it('publishes $identify once at initialize and never again for tool calls replaying the token', async () => {
      // Pod A handles initialize: mints the token and announces the identity.
      const podA = createPod('pod-identify-a', { identify: async () => IDENTITY })
      const transportA: { sessionId?: string } = {}
      setFakeTransport(podA.server, transportA)
      await invokeHandler(podA.lowLevel, 'initialize', INITIALIZE_REQUEST, { requestInfo: { headers: {} } })

      const token = transportA.sessionId
      expect(decodeSessionId(token)).not.toBeNull()
      expect(eventCapture.findCapturesByEvent('$identify')).toHaveLength(1)

      // Fresh pods share nothing with pod A — their identity caches are empty,
      // but the replayed token says the session was announced at initialize.
      for (const podName of ['pod-identify-b', 'pod-identify-c']) {
        const pod = createPod(podName, { identify: async () => IDENTITY })
        await invokeHandler(pod.lowLevel, 'tools/call', PLAN_CALL, {
          requestInfo: { headers: { 'mcp-session-id': token } },
        })
      }

      expect(eventCapture.findCapturesByEvent('$identify')).toHaveLength(1)

      // Suppressing $identify must not lose attribution: every tool call still
      // carries the identified user.
      const toolCalls = eventCapture.findCapturesByEvent('$mcp_tool_call')
      expect(toolCalls).toHaveLength(2)
      for (const toolCall of toolCalls) {
        expect(toolCall.distinct_id).toBe('user_mock')
        expect(toolCall.properties.$set).toMatchObject({ email: 'mock@example.com', plan: 'enterprise' })
      }
    })

    it('still publishes $identify for a first-seen identity when no token is in play', async () => {
      const pod = createPod('pod-identify-generated', { identify: async () => IDENTITY })

      await invokeHandler(pod.lowLevel, 'tools/call', PLAN_CALL, { requestInfo: { headers: {} } })

      expect(eventCapture.findCapturesByEvent('$identify')).toHaveLength(1)
    })
  })
})
