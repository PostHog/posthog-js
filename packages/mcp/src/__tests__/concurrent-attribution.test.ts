import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrument } from '../index'
import { encodeSessionId } from '../extensions/session-token'
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

function createServer(options: MCPAnalyticsOptions): MCPServerLike {
  const server = new Server({ name: 'concurrency-test', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(CallToolRequestSchema, async (request) => ({
    content: [{ type: 'text', text: String(request.params.arguments?.requestLabel) }],
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
    await Promise.resolve()

    const toolCalls = capture.findCapturesByEvent('$mcp_tool_call')
    const captureA = toolCalls.find((event) => event.properties.requestLabel === 'A')
    const captureB = toolCalls.find((event) => event.properties.requestLabel === 'B')

    expect(captureA?.distinct_id).toBe('user-A')
    expect(captureA?.properties.$set).toMatchObject({ requestLabel: 'A' })
    expect(captureB?.distinct_id).toBe('user-B')
    expect(captureB?.properties.$set).toMatchObject({ requestLabel: 'B' })
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
    await Promise.resolve()

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
})
