import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrument } from '../index'
import { getServerTrackingData } from '../extensions/internal'
import { decodeSessionId, encodeSessionId } from '../extensions/session-token'
import type { CompatibleRequestHandlerExtra, MCPAnalyticsOptions, MCPRequestLike, MCPServerLike } from '../types'
import { EventCapture, fakePostHog } from './test-utils'

interface Deferred<T = void> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function flushCaptures(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50))
}

function createServer(options: MCPAnalyticsOptions): MCPServerLike {
  const server = new Server({ name: 'concurrency-test', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(CallToolRequestSchema, async (request) => ({
    content: [{ type: 'text', text: String(request.params.arguments?.requestLabel) }],
  }))
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: 'echo', description: 'Echoes a request label', inputSchema: { type: 'object' } }],
  }))
  instrument(server, fakePostHog(), options)
  return server as unknown as MCPServerLike
}

function invokeTool(
  server: MCPServerLike,
  requestLabel: string,
  extra?: CompatibleRequestHandlerExtra
): Promise<unknown> {
  const handler = server._requestHandlers.get('tools/call')
  if (!handler) {
    throw new Error('tools/call handler was not registered')
  }
  const request: MCPRequestLike = {
    method: 'tools/call',
    params: { name: 'echo', arguments: { requestLabel } },
  }
  return handler(request, extra)
}

function invokeListTools(server: MCPServerLike, extra?: CompatibleRequestHandlerExtra): Promise<unknown> {
  const handler = server._requestHandlers.get('tools/list')
  if (!handler) {
    throw new Error('tools/list handler was not registered')
  }
  return handler({ method: 'tools/list', params: {} }, extra)
}

function invokeInitialize(
  server: MCPServerLike,
  request: MCPRequestLike,
  extra?: CompatibleRequestHandlerExtra
): Promise<unknown> {
  const handler = server._requestHandlers.get('initialize')
  if (!handler) {
    throw new Error('initialize handler was not registered')
  }
  return handler(request, extra)
}

function setFakeTransport(server: MCPServerLike, transport: unknown): void {
  ;(server as unknown as { _transport?: unknown })._transport = transport
}

describe('concurrent request attribution', () => {
  let capture: EventCapture

  beforeEach(async () => {
    capture = new EventCapture()
    await capture.start()
  })

  afterEach(async () => {
    await capture.stop()
  })

  it('keeps each generated-session request attributed to the identity it resolved before delayed metadata', async () => {
    const metadataAStarted = deferred()
    const releaseMetadataA = deferred()
    const server = createServer({
      identify: async (request) => ({
        distinctId: `user-${request.params?.arguments?.requestLabel}`,
        properties: { requestLabel: request.params?.arguments?.requestLabel },
      }),
      eventProperties: async (request) => {
        const requestLabel = String(request.params?.arguments?.requestLabel)
        if (requestLabel === 'A') {
          metadataAStarted.resolve()
          await releaseMetadataA.promise
        }
        return { requestLabel }
      },
    })

    const requestA = invokeTool(server, 'A')
    await metadataAStarted.promise

    const requestB = invokeTool(server, 'B')
    await requestB
    releaseMetadataA.resolve()
    await requestA
    await flushCaptures()

    const toolCalls = capture.findCapturesByEvent('$mcp_tool_call')
    const captureA = toolCalls.find((event) => event.properties.requestLabel === 'A')
    const captureB = toolCalls.find((event) => event.properties.requestLabel === 'B')

    expect(captureA?.distinct_id).toBe('user-A')
    expect(captureA?.properties.$set).toMatchObject({ requestLabel: 'A' })
    expect(captureB?.distinct_id).toBe('user-B')
    expect(captureB?.properties.$set).toMatchObject({ requestLabel: 'B' })
  })

  it('snapshots token client metadata before an overlapping identify callback yields', async () => {
    const identifyAStarted = deferred()
    const releaseIdentifyA = deferred()
    const server = createServer({
      identify: async (request) => {
        const requestLabel = String(request.params?.arguments?.requestLabel)
        if (requestLabel === 'A') {
          identifyAStarted.resolve()
          await releaseIdentifyA.promise
        }
        return { distinctId: `user-${requestLabel}` }
      },
    })
    const tokenA = encodeSessionId({
      sessionId: 'ses_a',
      clientName: 'client-a',
      clientVersion: '1.0.0',
      protocolVersion: '2025-03-26',
    })
    const tokenB = encodeSessionId({
      sessionId: 'ses_b',
      clientName: 'client-b',
      clientVersion: '2.0.0',
      protocolVersion: '2025-06-18',
    })

    const requestA = invokeTool(server, 'A', {
      requestInfo: { headers: { 'mcp-session-id': tokenA } },
    })
    await identifyAStarted.promise

    await invokeTool(server, 'B', {
      requestInfo: { headers: { 'mcp-session-id': tokenB } },
    })
    releaseIdentifyA.resolve()
    await requestA
    await flushCaptures()

    const toolCalls = capture.findCapturesByEvent('$mcp_tool_call')
    const captureA = toolCalls.find((event) => event.distinct_id === 'user-A')
    const captureB = toolCalls.find((event) => event.distinct_id === 'user-B')

    expect(captureA?.properties).toMatchObject({
      $session_id: 'ses_a',
      $mcp_client_name: 'client-a',
      $mcp_client_version: '1.0.0',
      $mcp_protocol_version: '2025-03-26',
    })
    expect(captureB?.properties).toMatchObject({
      $session_id: 'ses_b',
      $mcp_client_name: 'client-b',
      $mcp_client_version: '2.0.0',
      $mcp_protocol_version: '2025-06-18',
    })
  })

  it('keeps tools/list anonymous while another request finishes identifying', async () => {
    const identifyAStarted = deferred()
    const releaseIdentifyA = deferred()
    const listMetadataStarted = deferred()
    const releaseListMetadata = deferred()
    const server = createServer({
      identify: async (request) => {
        if (request.method === 'tools/call') {
          identifyAStarted.resolve()
          await releaseIdentifyA.promise
          return { distinctId: 'user-A', properties: { requestLabel: 'A' } }
        }
        return null
      },
      eventProperties: async (request) => {
        if (request.method === 'tools/list') {
          listMetadataStarted.resolve()
          await releaseListMetadata.promise
        }
        return null
      },
    })
    const tokenA = encodeSessionId({ sessionId: 'ses_a', clientName: 'client-a', clientVersion: '1.0.0' })
    const tokenB = encodeSessionId({ sessionId: 'ses_b', clientName: 'client-b', clientVersion: '2.0.0' })

    const requestA = invokeTool(server, 'A', {
      requestInfo: { headers: { 'mcp-session-id': tokenA } },
    })
    await identifyAStarted.promise

    const listRequestB = invokeListTools(server, {
      requestInfo: { headers: { 'mcp-session-id': tokenB } },
    })
    await listMetadataStarted.promise

    releaseIdentifyA.resolve()
    await requestA
    releaseListMetadata.resolve()
    await listRequestB
    await flushCaptures()

    const listings = capture.findCapturesByEvent('$mcp_tools_list')
    expect(listings).toHaveLength(1)
    expect(listings[0].distinct_id).toBe('ses_b')
    expect(listings[0].properties).toMatchObject({
      $session_id: 'ses_b',
      $mcp_client_name: 'client-b',
      $mcp_client_version: '2.0.0',
      $process_person_profile: false,
    })
    expect(listings[0].properties.$set).toBeUndefined()
  })

  it('stamps the listing client before a slow identify lets another handshake replace it', async () => {
    const identifyListStarted = deferred()
    const releaseIdentifyList = deferred()
    const server = createServer({
      identify: async (request) => {
        if (request.method === 'tools/list') {
          identifyListStarted.resolve()
          await releaseIdentifyList.promise
        }
        return { distinctId: 'user-a' }
      },
    })
    const handshake = (name: string, version: string): MCPRequestLike => ({
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name, version } },
    })

    // client-a completes the handshake, so `getClientVersion()` — the last link of
    // the identity chain, and the only one a legacy-era request ever reaches —
    // answers 'client-a'.
    await invokeInitialize(server, handshake('client-a', '1.0.0'), { requestInfo: { headers: {} } })

    // A legacy-era listing: nothing in `_meta`, no envelope, no protocol header.
    const listRequest = invokeListTools(server, { requestInfo: { headers: {} } })
    await identifyListStarted.promise

    // client-b handshakes on the same instance while the identify callback is still
    // in flight, replacing what the accessor answers.
    await invokeInitialize(server, handshake('client-b', '2.0.0'), { requestInfo: { headers: {} } })

    releaseIdentifyList.resolve()
    await listRequest
    await flushCaptures()

    const listings = capture.findCapturesByEvent('$mcp_tools_list')
    expect(listings).toHaveLength(1)
    expect(listings[0].distinct_id).toBe('user-a')
    expect(listings[0].properties).toMatchObject({
      $mcp_client_name: 'client-a',
      $mcp_client_version: '1.0.0',
    })
  })

  it("uses each request's pre-await session source when deciding whether to publish identify", async () => {
    const identifyAStarted = deferred()
    const releaseIdentifyA = deferred()
    const server = createServer({
      identify: async (request) => {
        const requestLabel = String(request.params?.arguments?.requestLabel)
        if (requestLabel === 'A') {
          identifyAStarted.resolve()
          await releaseIdentifyA.promise
        }
        return { distinctId: `user-${requestLabel}` }
      },
    })
    const tokenB = encodeSessionId({ sessionId: 'ses_b', clientName: 'client-b', clientVersion: '2.0.0' })

    const requestA = invokeTool(server, 'A')
    await identifyAStarted.promise
    await invokeTool(server, 'B', {
      requestInfo: { headers: { 'mcp-session-id': tokenB } },
    })
    releaseIdentifyA.resolve()
    await requestA
    await flushCaptures()

    const identifyCaptures = capture.findCapturesByEvent('$identify')
    expect(identifyCaptures).toHaveLength(1)
    expect(identifyCaptures[0].distinct_id).toBe('user-A')
  })

  it('keeps a delayed initialize token and shared state scoped to their requests', async () => {
    const initializeMetadataStarted = deferred()
    const releaseInitializeMetadata = deferred()
    const server = createServer({
      eventProperties: async (request) => {
        if (request.method === 'initialize') {
          initializeMetadataStarted.resolve()
          await releaseInitializeMetadata.promise
        }
        return null
      },
    })
    const transport: { sessionId?: string } = {}
    setFakeTransport(server, transport)
    const initializeRequest: MCPRequestLike = {
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'client-a', version: '1.0.0' },
      },
    }
    const tokenB = encodeSessionId({
      sessionId: 'ses_b',
      clientName: 'client-b',
      clientVersion: '2.0.0',
      protocolVersion: '2099-token-b',
    })

    const initializeA = invokeInitialize(server, initializeRequest, { requestInfo: { headers: {} } })
    await initializeMetadataStarted.promise
    const initialToken = decodeSessionId(transport.sessionId)
    expect(initialToken?.clientName).toBe('client-a')

    await invokeTool(server, 'B', {
      requestInfo: { headers: { 'mcp-session-id': tokenB } },
    })
    releaseInitializeMetadata.resolve()
    await initializeA
    await flushCaptures()

    const upgradedToken = decodeSessionId(transport.sessionId)
    expect(upgradedToken).toMatchObject({
      sessionId: initialToken?.sessionId,
      clientName: 'client-a',
      clientVersion: '1.0.0',
      protocolVersion: '2025-06-18',
    })

    const data = getServerTrackingData(server)
    expect(data?.sessionId).toBe('ses_b')
    expect(data?.sessionInfo).toMatchObject({
      clientName: 'client-b',
      clientVersion: '2.0.0',
      protocolVersion: '2099-token-b',
    })

    const initializeCaptures = capture.findCapturesByEvent('$mcp_initialize')
    expect(initializeCaptures).toHaveLength(1)
    expect(initializeCaptures[0].properties).toMatchObject({
      $session_id: initialToken?.sessionId,
      $mcp_client_name: 'client-a',
      $mcp_client_version: '1.0.0',
      $mcp_protocol_version: '2025-06-18',
    })
  })

  it('keeps token client and protocol metadata scoped to each overlapping request', async () => {
    const metadataAStarted = deferred()
    const releaseMetadataA = deferred()
    const server = createServer({
      eventProperties: async (request) => {
        const requestLabel = String(request.params?.arguments?.requestLabel)
        if (requestLabel === 'A') {
          metadataAStarted.resolve()
          await releaseMetadataA.promise
        }
        return { requestLabel }
      },
    })
    const tokenA = encodeSessionId({
      sessionId: 'ses_a',
      clientName: 'client-a',
      clientVersion: '1.0.0',
      protocolVersion: '2025-03-26',
    })
    const tokenB = encodeSessionId({
      sessionId: 'ses_b',
      clientName: 'client-b',
      clientVersion: '2.0.0',
      protocolVersion: '2025-06-18',
    })

    const requestA = invokeTool(server, 'A', {
      requestInfo: { headers: { 'mcp-session-id': tokenA } },
    })
    await metadataAStarted.promise

    const requestB = invokeTool(server, 'B', {
      requestInfo: { headers: { 'mcp-session-id': tokenB } },
    })
    await requestB
    releaseMetadataA.resolve()
    await requestA
    await flushCaptures()

    const toolCalls = capture.findCapturesByEvent('$mcp_tool_call')
    const captureA = toolCalls.find((event) => event.properties.requestLabel === 'A')
    const captureB = toolCalls.find((event) => event.properties.requestLabel === 'B')

    expect(captureA?.properties).toMatchObject({
      $session_id: 'ses_a',
      $mcp_client_name: 'client-a',
      $mcp_client_version: '1.0.0',
      $mcp_protocol_version: '2025-03-26',
    })
    expect(captureB?.properties).toMatchObject({
      $session_id: 'ses_b',
      $mcp_client_name: 'client-b',
      $mcp_client_version: '2.0.0',
      $mcp_protocol_version: '2025-06-18',
    })
  })

  it('keeps each request attributed to the client surface its own headers named', async () => {
    const metadataAStarted = deferred()
    const releaseMetadataA = deferred()
    const server = createServer({
      eventProperties: async (request) => {
        const requestLabel = String(request.params?.arguments?.requestLabel)
        if (requestLabel === 'A') {
          metadataAStarted.resolve()
          await releaseMetadataA.promise
        }
        return { requestLabel }
      },
    })

    const requestA = invokeTool(server, 'A', {
      requestInfo: { headers: { 'user-agent': 'claude-code/2.1.0 (cli)', 'x-anthropic-client': 'claude-code' } },
    })
    await metadataAStarted.promise

    await invokeTool(server, 'B', {
      requestInfo: { headers: { 'user-agent': 'claude-code/2.1.0 (claude-vscode)' } },
    })
    releaseMetadataA.resolve()
    await requestA
    await flushCaptures()

    const toolCalls = capture.findCapturesByEvent('$mcp_tool_call')
    const captureA = toolCalls.find((event) => event.properties.requestLabel === 'A')
    const captureB = toolCalls.find((event) => event.properties.requestLabel === 'B')

    expect(captureA?.properties).toMatchObject({
      $mcp_client_user_agent: 'claude-code/2.1.0 (cli)',
      $mcp_vendor_client: 'claude-code',
    })
    expect(captureB?.properties.$mcp_client_user_agent).toBe('claude-code/2.1.0 (claude-vscode)')
    // B never sent the vendor header, so A's must not bleed into B's event.
    expect(captureB?.properties).not.toHaveProperty('$mcp_vendor_client')
  })

  it('keeps failed tool events attributed to the request that threw', async () => {
    const toolAStarted = deferred()
    const releaseToolA = deferred()
    const server = createServer({
      identify: async (request) => ({
        distinctId: `user-${request.params?.arguments?.requestLabel}`,
      }),
    })
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const requestLabel = String(request.params.arguments?.requestLabel)
      if (requestLabel === 'A') {
        toolAStarted.resolve()
        await releaseToolA.promise
        throw new Error('tool A failed')
      }
      return { content: [{ type: 'text', text: requestLabel }] }
    })
    const tokenA = encodeSessionId({
      sessionId: 'ses_a',
      clientName: 'client-a',
      clientVersion: '1.0.0',
      protocolVersion: '2025-03-26',
    })
    const tokenB = encodeSessionId({
      sessionId: 'ses_b',
      clientName: 'client-b',
      clientVersion: '2.0.0',
      protocolVersion: '2025-06-18',
    })

    const requestA = invokeTool(server, 'A', {
      requestInfo: { headers: { 'mcp-session-id': tokenA } },
    })
    await toolAStarted.promise
    await invokeTool(server, 'B', {
      requestInfo: { headers: { 'mcp-session-id': tokenB } },
    })
    releaseToolA.resolve()
    await expect(requestA).rejects.toThrow('tool A failed')
    await flushCaptures()

    const failedToolCall = capture
      .findCapturesByEvent('$mcp_tool_call')
      .find((event) => event.properties.$mcp_is_error === true)
    expect(failedToolCall?.distinct_id).toBe('user-A')
    expect(failedToolCall?.properties).toMatchObject({
      $session_id: 'ses_a',
      $mcp_client_name: 'client-a',
      $mcp_client_version: '1.0.0',
      $mcp_protocol_version: '2025-03-26',
    })
  })

  it('keeps failed tools/list events attributed to the request that failed', async () => {
    const listAStarted = deferred()
    const releaseListA = deferred()
    const server = createServer({})
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      listAStarted.resolve()
      await releaseListA.promise
      throw new Error('list A failed')
    })
    const tokenA = encodeSessionId({
      sessionId: 'ses_a',
      clientName: 'client-a',
      clientVersion: '1.0.0',
      protocolVersion: '2025-03-26',
    })
    const tokenB = encodeSessionId({
      sessionId: 'ses_b',
      clientName: 'client-b',
      clientVersion: '2.0.0',
      protocolVersion: '2025-06-18',
    })

    const listA = invokeListTools(server, {
      requestInfo: { headers: { 'mcp-session-id': tokenA } },
    })
    await listAStarted.promise
    await invokeTool(server, 'B', {
      requestInfo: { headers: { 'mcp-session-id': tokenB } },
    })
    releaseListA.resolve()
    await expect(listA).rejects.toThrow('list A failed')
    await flushCaptures()

    const failedList = capture.findCapturesByEvent('$mcp_tools_list')[0]
    expect(failedList?.distinct_id).toBe('ses_a')
    expect(failedList?.properties).toMatchObject({
      $session_id: 'ses_a',
      $mcp_client_name: 'client-a',
      $mcp_client_version: '1.0.0',
      $mcp_protocol_version: '2025-03-26',
      $mcp_is_error: true,
    })
  })
})
