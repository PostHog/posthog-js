import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrument, PostHogMCP } from '../index'
import type { MCPAnalyticsOptions, MCPRequestLike, MCPServerLike } from '../types'
import { EventCapture, fakePostHog } from './test-utils'

describe('MCP analytics defaults', () => {
  let capture: EventCapture
  beforeEach(async () => {
    capture = new EventCapture()
    await capture.start()
  })
  afterEach(async () => capture.stop())

  function fresh(
    options?: MCPAnalyticsOptions,
    properties: Record<string, { type: string }> = { value: { type: 'string' } }
  ) {
    const server = new Server({ name: 'defaults', version: '1' }, { capabilities: { tools: {} } })
    const received = vi.fn(async (_request: MCPRequestLike) => ({ content: [{ type: 'text', text: 'ok' }] }))
    const listing = vi.fn(async () => ({ tools: [{ name: 'echo', inputSchema: { type: 'object', properties } }] }))
    server.setRequestHandler(ListToolsRequestSchema, listing)
    server.setRequestHandler(CallToolRequestSchema, received)
    instrument(server, fakePostHog(), options)
    const low = server as unknown as MCPServerLike
    return {
      received,
      listing,
      request: (method: string, args?: Record<string, unknown>) =>
        low._requestHandlers.get(method)!({ method, params: args ? { name: 'echo', arguments: args } : {} }),
    }
  }

  it('captures model and correlates calls across fresh instances without opt-in', async () => {
    const discovery = (await fresh().request('tools/list')) as any
    expect(discovery.tools.map((tool: any) => tool.name)).toEqual(['echo'])
    expect(Object.keys(discovery.tools[0].inputSchema.properties)).toEqual(
      expect.arrayContaining(['context', 'llm_model', 'conversation_id'])
    )
    const first = fresh()
    const result = (await first.request('tools/call', {
      value: 'first',
      context: 'intent',
      llm_model: 'model-a',
    })) as any
    const handle = JSON.parse(result.content[1].text).conversation_id
    const second = fresh()
    await second.request('tools/call', {
      value: 'second',
      context: 'intent',
      llm_model: 'model-a',
      conversation_id: handle,
    })
    const calls = capture.findCapturesByEvent('$mcp_tool_call')
    expect(calls).toHaveLength(2)
    expect(calls[0].properties.$mcp_llm_model).toBe('model-a')
    expect(calls[0].properties.$session_id).toBe(calls[1].properties.$session_id)
    expect(first.received.mock.calls[0][0].params.arguments).toEqual({ value: 'first' })
    expect(capture.findCapturesByEvent('$mcp_tools_list')).toHaveLength(1)
  })

  it('keeps explicit opt-outs inert', async () => {
    const server = fresh({ captureModel: false, enableConversationId: false, context: false })
    const result = (await server.request('tools/call', { value: 'v', llm_model: 'application-model' })) as any
    expect(server.listing).not.toHaveBeenCalled()
    expect(result.content).toHaveLength(1)
    expect(capture.findCapturesByEvent('$mcp_tool_call')[0].properties.$mcp_llm_model).toBeUndefined()
  })

  it('preserves tool-owned analytics names on a cold instance', async () => {
    const properties = Object.fromEntries(
      ['value', 'context', 'llm_model', 'conversation_id'].map((key) => [key, { type: 'string' }])
    )
    const server = fresh(undefined, properties)
    const args = {
      value: 'v',
      context: 'application context',
      llm_model: 'application model',
      conversation_id: 'application conversation',
    }
    await server.request('tools/call', args)
    expect(server.received.mock.calls[0][0].params?.arguments).toEqual(args)
    const event = capture.findCapturesByEvent('$mcp_tool_call')[0].properties
    expect(event.$mcp_llm_model).toBeUndefined()
    expect(event.$mcp_conversation_id).toBeUndefined()
  })

  it('dispatches unchanged when the raw catalog fails', async () => {
    const server = fresh()
    server.listing.mockRejectedValue(new Error('catalog unavailable'))
    const args = { value: 'v', llm_model: 'unresolved model' }
    const result = (await server.request('tools/call', args)) as any
    expect(result.content).toHaveLength(1)
    expect(server.received.mock.calls[0][0].params?.arguments).toEqual(args)
    expect(capture.findCapturesByEvent('$mcp_tool_call')).toHaveLength(1)
  })

  it('enables model capture for custom dispatchers while honoring opt-out', () => {
    for (const enabled of [undefined, false]) {
      const client = new PostHogMCP('test', { disabled: true, captureModel: enabled })
      const tools = client.prepareToolList([{ name: 'echo', inputSchema: { type: 'object', properties: {} } }])
      expect(Boolean(tools[0].inputSchema?.properties?.llm_model)).toBe(enabled !== false)
    }
  })
})
