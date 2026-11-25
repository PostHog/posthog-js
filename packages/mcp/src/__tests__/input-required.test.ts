import {
  createMcpHandler,
  fromJsonSchema,
  InMemoryTransport,
  inputRequired,
  McpServer,
} from '@modelcontextprotocol/server'
import type { JSONRPCMessage } from '@modelcontextprotocol/server'

import { instrument } from '../index'
import { PostHogMCPAnalyticsEvent, PostHogMCPAnalyticsProperty } from '../extensions/constants'
import type { MCPServerLike } from '../types'
import { EventCapture, fakePostHog } from './test-utils'

const MODERN = '2026-07-28'
const LEGACY = '2025-11-25'
const CONFIRM_MESSAGE = 'Delete project secret-42?'
const CAPABILITIES = { elicitation: {}, roots: {} }
const ANSWERS = {
  z_confirm: { action: 'accept', content: { confirm: true } },
  a_roots: { roots: [] },
}

const askForConfirmation = () =>
  inputRequired({
    inputRequests: {
      z_confirm: inputRequired.elicit({
        message: CONFIRM_MESSAGE,
        requestedSchema: fromJsonSchema({ type: 'object', properties: { confirm: { type: 'boolean' } } }),
      }),
      a_roots: inputRequired.listRoots(),
    },
  })

/** A tool that asks for more input before it runs: by default a confirmation and the client's roots. */
function confirmingServer(round = askForConfirmation): McpServer {
  const server = new McpServer({ name: 'confirming', version: '1.0.0' })
  server.registerTool('delete_project', { description: 'Delete a project' }, async (ctx) => {
    if (ctx.mcpReq.inputResponses?.z_confirm) {
      return { content: [{ type: 'text', text: 'deleted' }] }
    }
    return round()
  })
  instrument(server as unknown as MCPServerLike, fakePostHog())
  return server
}

/** A 2026-07-28 client: every request is its own HTTP request on a fresh server. */
async function modernCall(
  params: Record<string, unknown>,
  buildServer = () => confirmingServer()
): Promise<Record<string, unknown>> {
  const handler = createMcpHandler(buildServer, { responseMode: 'json' })
  const response = await handler.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': MODERN,
        'mcp-method': 'tools/call',
        'mcp-name': 'delete_project',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'delete_project',
          arguments: {},
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': MODERN,
            'io.modelcontextprotocol/clientInfo': { name: 'modern-client', version: '1.0.0' },
            'io.modelcontextprotocol/clientCapabilities': CAPABILITIES,
          },
        },
      }),
    })
  )
  return ((await response.json()) as { result: Record<string, unknown> }).result
}

/** A 2025-11-25 client on one connection, answering the server's requests itself. */
async function legacyCall(): Promise<Record<string, unknown>> {
  const [client, transport] = InMemoryTransport.createLinkedPair()
  await confirmingServer().connect(transport)
  const pending = new Map<number, (result: Record<string, unknown>) => void>()
  client.onmessage = (message: JSONRPCMessage) => {
    const { id, method, result } = message as { id?: number; method?: string; result?: Record<string, unknown> }
    if (method === 'elicitation/create') void client.send({ jsonrpc: '2.0', id: id!, result: ANSWERS.z_confirm })
    else if (method === 'roots/list') void client.send({ jsonrpc: '2.0', id: id!, result: ANSWERS.a_roots })
    else if (id !== undefined && result) pending.get(id)?.(result)
  }
  await client.start()
  const request = (id: number, method: string, params: Record<string, unknown>) =>
    new Promise<Record<string, unknown>>((resolve) => {
      pending.set(id, resolve)
      void client.send({ jsonrpc: '2.0', id, method, params })
    })
  await request(1, 'initialize', {
    protocolVersion: LEGACY,
    capabilities: CAPABILITIES,
    clientInfo: { name: 'legacy-client', version: '1.0.0' },
  })
  await client.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  return request(2, 'tools/call', { name: 'delete_project', arguments: {} })
}

describe('a tool that asks the client for more input', () => {
  let capture: EventCapture

  beforeEach(async () => {
    capture = new EventCapture()
    await capture.start()
  })

  afterEach(async () => {
    await capture.stop()
  })

  it('records a 2026-07-28 round as $mcp_input_required and only the retry as a tool call', async () => {
    const round = await modernCall({})
    expect(round.resultType).toBe('input_required')
    expect(capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.ToolCall)).toHaveLength(0)

    const retry = await modernCall({ inputResponses: ANSWERS })
    expect(retry.content).toContainEqual({ type: 'text', text: 'deleted' })

    expect(capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.ToolCall)).toHaveLength(1)
    const rounds = capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.InputRequired)
    expect(rounds).toHaveLength(1)
    const properties = rounds[0].properties
    expect(properties).toMatchObject({
      [PostHogMCPAnalyticsProperty.ToolName]: 'delete_project',
      [PostHogMCPAnalyticsProperty.InputRequestMethods]: ['roots/list', 'elicitation/create'],
      [PostHogMCPAnalyticsProperty.ProtocolVersion]: MODERN,
    })
    expect(properties[PostHogMCPAnalyticsProperty.DurationMs]).toBeGreaterThanOrEqual(0)
    expect(properties[PostHogMCPAnalyticsProperty.IsError]).toBeUndefined()
    expect(properties[PostHogMCPAnalyticsProperty.ConversationId]).toBeUndefined()
    expect(JSON.stringify(capture.getCaptures())).not.toContain(CONFIRM_MESSAGE)
  })

  it('records no methods for a round that carries only requestState', async () => {
    await modernCall({}, () => confirmingServer(() => inputRequired({ requestState: 'state-only' })))

    const rounds = capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.InputRequired)
    expect(rounds).toHaveLength(1)
    expect(rounds[0].properties[PostHogMCPAnalyticsProperty.InputRequestMethods]).toEqual([])
    expect(JSON.stringify(capture.getCaptures())).not.toContain('state-only')
  })

  it('records one tool call when the MCP SDK answers the round for a 2025-11-25 client', async () => {
    const result = await legacyCall()
    expect(result.content).toContainEqual({ type: 'text', text: 'deleted' })

    expect(capture.getCaptures().map((c) => c.event)).not.toContain(PostHogMCPAnalyticsEvent.InputRequired)
    const calls = capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.ToolCall)
    expect(calls).toHaveLength(1)
    expect(calls[0].properties[PostHogMCPAnalyticsProperty.IsError]).toBe(false)
  })
})
