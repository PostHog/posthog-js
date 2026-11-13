import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  LATEST_PROTOCOL_VERSION,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { instrument } from '../index'
import { getServerTrackingData } from '../extensions/internal'
import { decodeSessionId } from '../extensions/session-token'
import type { CompatibleRequestHandlerExtra, MCPAnalyticsOptions, MCPRequestLike, MCPServerLike } from '../types'
import { EventCapture, fakePostHog, RecordingTransport } from './test-utils'

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
  instrument(server, fakePostHog(), { enableConversationId: false, ...options })
  return { server, lowLevel: server as unknown as MCPServerLike }
}

function setFakeTransport(server: Server, transport: unknown): void {
  ;(server as unknown as { _transport?: unknown })._transport = transport
}

/**
 * Connects the pod to `transport` and runs `initialize` through the SDK the way
 * an HTTP client does. Resolves with the token its response carried.
 */
async function mintToken(
  server: Server,
  params: MCPRequestLike['params'] = INITIALIZE_REQUEST.params,
  transport = new RecordingTransport()
): Promise<string | undefined> {
  await server.connect(transport)
  const response = await transport.request({ id: 1, method: 'initialize', params })
  // captureEvent publishes fire-and-forget; let the sink drain.
  await new Promise((resolve) => setTimeout(resolve, 25))
  return response.sessionId
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

    const decoded = decodeSessionId(await mintToken(server))
    expect(decoded).not.toBeNull()
    expect(decoded?.clientName).toBe('Claude')
    expect(decoded?.clientVersion).toBe('1.2.3')
    // Token is re-minted with the negotiated version after the handler runs.
    expect(decoded?.protocolVersion).toBe('2025-06-18')

    const data = getServerTrackingData(lowLevel)
    expect(data?.sessionSource).toBe('token')
    expect(data?.sessionId).toBe(decoded?.sessionId)

    const initEvents = eventCapture.findCapturesByEvent('$mcp_initialize')
    expect(initEvents).toHaveLength(1)
    expect(initEvents[0].properties.$session_id).toBe(decoded?.sessionId)
    expect(initEvents[0].properties.$mcp_client_name).toBe('Claude')
    expect(initEvents[0].properties.$mcp_client_version).toBe('1.2.3')
    // Negotiated spec version off the real SDK initialize response (echoes the
    // requested version, which the SDK supports).
    expect(initEvents[0].properties.$mcp_protocol_version).toBe('2025-06-18')
  })

  it('mints through a getter-only wrapper transport (Node StreamableHTTP shape)', async () => {
    const { server, lowLevel } = createPod('pod-wrapper')
    const inner: { sessionId?: string } = {}
    const wrapper = Object.assign(new RecordingTransport(), { _webStandardTransport: inner })
    Object.defineProperty(wrapper, 'sessionId', { get: () => inner.sessionId, configurable: true })

    const decoded = decodeSessionId(await mintToken(server, INITIALIZE_REQUEST.params, wrapper))
    expect(decoded).not.toBeNull()
    expect(getServerTrackingData(lowLevel)?.sessionId).toBe(decoded?.sessionId)
  })

  // SDK v2 before 2.3 lets a host reuse one stateless transport for every client.
  it('gives each client on a shared transport its own token, and leaves none on the transport', async () => {
    const { server } = createPod('pod-shared-transport')
    const transport = new RecordingTransport()
    await server.connect(transport)
    const initialize = (name: string) =>
      transport.request({
        id: 1,
        method: 'initialize',
        params: { ...INITIALIZE_REQUEST.params, clientInfo: { name, version: '1.0.0' } },
      })

    const responses = [
      await initialize('client-a'),
      await initialize('client-b'),
      await transport.request({ id: 2, method: 'tools/list' }),
    ]

    expect(responses.map((response) => decodeSessionId(response.sessionId)?.clientName)).toEqual([
      'client-a',
      'client-b',
      undefined,
    ])
    expect(transport.sessionId).toBeUndefined()
  })

  describe('mint guards', () => {
    const HTTP_REQUEST = { headers: {} }

    /**
     * 2026-07-28 removed sessions from the protocol — a server MUST NOT mint or
     * echo `Mcp-Session-Id` under it. That era has no `initialize` handshake, so
     * today this branch is unreachable through a real v2 server; the gate exists
     * so compliance does not depend on that routing detail staying true, and so
     * a host that routes an initialize-shaped request on a modern connection is
     * still answered correctly.
     */
    it.each([
      { case: 'without requestInfo (stdio / in-memory transports)', requestInfo: null },
      {
        case: 'when the client already sent a session id header',
        requestInfo: { headers: { 'mcp-session-id': 'client-supplied' } },
      },
      {
        case: 'over a stateful transport that owns its session id',
        requestInfo: HTTP_REQUEST,
        transportSessionId: 'transport-owned-uuid',
      },
      {
        case: 'for a request declaring 2026-07-28, the revision that removed sessions',
        requestInfo: HTTP_REQUEST,
        protocolVersion: '2026-07-28',
      },
      {
        case: 'for a request declaring a later revision (removed, not re-added)',
        requestInfo: HTTP_REQUEST,
        protocolVersion: '2027-03-01',
      },
    ])('does not mint $case', async ({ requestInfo, transportSessionId, protocolVersion }) => {
      const { server, lowLevel } = createPod('pod-guard')
      const transport = new RecordingTransport()
      transport.sessionId = transportSessionId
      await server.connect(transport)

      const response = await transport.request(
        {
          id: 1,
          method: 'initialize',
          params: { ...INITIALIZE_REQUEST.params, protocolVersion: protocolVersion ?? '2025-06-18' },
        },
        requestInfo
      )

      expect(response.sessionId).toBe(transportSessionId)
      expect(getServerTrackingData(lowLevel)?.sessionSource).not.toBe('token')
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
    const token = await mintToken(podA.server)

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
    // Spec version also rides the token, so pod B stamps it despite never seeing initialize.
    expect(toolCalls[0].properties.$mcp_protocol_version).toBe('2025-06-18')
  })

  it('stamps $mcp_protocol_version on same-pod tool calls after initialize (no token replay)', async () => {
    const { server, lowLevel } = createPod('pod-persist')
    setFakeTransport(server, {})

    await invokeHandler(lowLevel, 'initialize', INITIALIZE_REQUEST, { requestInfo: { headers: {} } })
    // A later request with no session header falls back to in-memory session state;
    // the negotiated version persisted at initialize must still be stamped.
    await invokeHandler(lowLevel, 'tools/call', {
      method: 'tools/call',
      params: { name: 'get_plan', arguments: {} },
    })

    const toolCalls = eventCapture.findCapturesByEvent('$mcp_tool_call')
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0].properties.$mcp_protocol_version).toBe('2025-06-18')
  })

  it('reports the negotiated version (not the requested one) after a server downgrade', async () => {
    // The client requests a version the server does not support, so the SDK
    // downgrades to its own latest — requested !== negotiated.
    const downgradeRequest: MCPRequestLike = {
      method: 'initialize',
      params: { protocolVersion: '1999-01-01', capabilities: {}, clientInfo: { name: 'Claude', version: '1.2.3' } },
    }

    const podA = createPod('pod-downgrade-a')
    const token = await mintToken(podA.server, downgradeRequest.params)

    const initEvents = eventCapture.findCapturesByEvent('$mcp_initialize')
    const negotiated = initEvents[0].properties.$mcp_protocol_version as string
    expect(negotiated).not.toBe('1999-01-01') // server downgraded
    // The re-minted token carries the negotiated version, not the requested one.
    expect(decodeSessionId(token)?.protocolVersion).toBe(negotiated)

    // A different pod replaying the token reports the negotiated version too.
    const podB = createPod('pod-downgrade-b')
    await invokeHandler(
      podB.lowLevel,
      'tools/call',
      { method: 'tools/call', params: { name: 'get_plan', arguments: {} } },
      { requestInfo: { headers: { 'mcp-session-id': token } } }
    )
    const toolCalls = eventCapture.findCapturesByEvent('$mcp_tool_call')
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0].properties.$mcp_protocol_version).toBe(negotiated)
    expect(toolCalls[0].properties.$mcp_protocol_version).not.toBe('1999-01-01')
  })

  describe('identify across stateless pods', () => {
    const IDENTITY = { distinctId: 'user_mock', properties: { email: 'mock@example.com', plan: 'enterprise' } }
    const PLAN_CALL: MCPRequestLike = { method: 'tools/call', params: { name: 'get_plan', arguments: {} } }

    it('attributes tool calls on fresh pods replaying the token without publishing $identify', async () => {
      // Pod A handles initialize and mints the token.
      const podA = createPod('pod-identify-a', { identify: async () => IDENTITY })
      const token = await mintToken(podA.server)

      expect(decodeSessionId(token)).not.toBeNull()

      // Fresh pods share nothing with pod A, so their identity caches are empty.
      for (const podName of ['pod-identify-b', 'pod-identify-c']) {
        const pod = createPod(podName, { identify: async () => IDENTITY })
        await invokeHandler(pod.lowLevel, 'tools/call', PLAN_CALL, {
          requestInfo: { headers: { 'mcp-session-id': token } },
        })
      }

      expect(eventCapture.findCapturesByEvent('$identify')).toHaveLength(0)
      const toolCalls = eventCapture.findCapturesByEvent('$mcp_tool_call')
      expect(toolCalls).toHaveLength(2)
      for (const toolCall of toolCalls) {
        expect(toolCall.distinct_id).toBe('user_mock')
        expect(toolCall.properties.$set).toMatchObject({ email: 'mock@example.com', plan: 'enterprise' })
      }
    })

    it('publishes no $identify for a first-seen identity when no token is in play', async () => {
      const pod = createPod('pod-identify-generated', { identify: async () => IDENTITY })

      await invokeHandler(pod.lowLevel, 'tools/call', PLAN_CALL, { requestInfo: { headers: {} } })

      expect(eventCapture.findCapturesByEvent('$identify')).toHaveLength(0)
      expect(eventCapture.findCapturesByEvent('$mcp_tool_call')[0].distinct_id).toBe('user_mock')
    })
  })

  describe('sendInitializeEvent: false', () => {
    const OFF: MCPAnalyticsOptions = { sendInitializeEvent: false }
    const callTool = { method: 'tools/call', params: { name: 'get_plan', arguments: {} } }

    it('sends no $mcp_initialize but still mints the token another pod resolves', async () => {
      const podA = createPod('pod-off-a', OFF)
      const token = await mintToken(podA.server)

      const decoded = decodeSessionId(token)
      expect(decoded).not.toBeNull()
      expect(eventCapture.findCapturesByEvent('$mcp_initialize')).toHaveLength(0)

      const podB = createPod('pod-off-b', OFF)
      await invokeHandler(podB.lowLevel, 'tools/call', callTool, {
        requestInfo: { headers: { 'mcp-session-id': token } },
      })

      const toolCalls = eventCapture.findCapturesByEvent('$mcp_tool_call')
      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].properties.$session_id).toBe(decoded?.sessionId)
      expect(toolCalls[0].properties.$mcp_client_name).toBe('Claude')
      expect(toolCalls[0].properties.$mcp_client_version).toBe('1.2.3')
      expect(toolCalls[0].properties.$mcp_protocol_version).toBe('2025-06-18')
    })

    it('still re-mints the token with the negotiated version after a downgrade', async () => {
      const podA = createPod('pod-off-downgrade', OFF)
      const token = await mintToken(podA.server, { ...INITIALIZE_REQUEST.params, protocolVersion: '1999-01-01' })

      expect(decodeSessionId(token)?.protocolVersion).toBe(LATEST_PROTOCOL_VERSION)
      expect(eventCapture.findCapturesByEvent('$mcp_initialize')).toHaveLength(0)
    })

    it('still stamps the negotiated version on same-pod tool calls', async () => {
      const { server, lowLevel } = createPod('pod-off-persist', OFF)
      setFakeTransport(server, {})
      await invokeHandler(lowLevel, 'initialize', INITIALIZE_REQUEST, { requestInfo: { headers: {} } })
      await invokeHandler(lowLevel, 'tools/call', callTool)

      const toolCalls = eventCapture.findCapturesByEvent('$mcp_tool_call')
      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].properties.$mcp_protocol_version).toBe('2025-06-18')
    })
  })
})
