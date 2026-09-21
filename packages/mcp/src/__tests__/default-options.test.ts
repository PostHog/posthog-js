import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrument } from '../index'
import { encodeSessionId } from '../extensions/session-token'
import { deriveSessionIdFromConversation, deriveSessionIdFromMCPSession } from '../extensions/session'
import type { CompatibleRequestHandlerExtra, MCPAnalyticsOptions, MCPRequestLike, MCPServerLike } from '../types'
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
    properties: Record<string, { type: string }> = { value: { type: 'string' } },
    structured = false
  ) {
    const server = new Server({ name: 'defaults', version: '1' }, { capabilities: { tools: {} } })
    const received = vi.fn(async (_request: MCPRequestLike) => ({
      content: [{ type: 'text', text: 'ok' }],
      ...(structured ? { structuredContent: { ok: true } } : {}),
    }))
    const listing = vi.fn(async () => ({
      tools: [
        {
          name: 'echo',
          inputSchema: { type: 'object', properties },
          ...(structured
            ? { outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, additionalProperties: false } }
            : {}),
        },
      ],
    }))
    server.setRequestHandler(ListToolsRequestSchema, listing)
    server.setRequestHandler(CallToolRequestSchema, received)
    instrument(server, fakePostHog(), options)
    const low = server as unknown as MCPServerLike
    return {
      received,
      listing,
      request: (method: string, args?: Record<string, unknown>, extra?: CompatibleRequestHandlerExtra) =>
        low._requestHandlers.get(method)!({ method, params: args ? { name: 'echo', arguments: args } : {} }, extra),
    }
  }

  it.each([false, true])('captures defaults across fresh instances; structured output: %s', async (structured) => {
    const make = () => fresh({ captureModel: undefined, enableConversationId: undefined }, undefined, structured)
    const discovery = (await make().request('tools/list')) as any
    expect(discovery.tools.map((tool: any) => tool.name)).toEqual(['echo'])
    expect(Object.keys(discovery.tools[0].inputSchema.properties)).toEqual(
      expect.arrayContaining(['context', 'llm_model', 'conversation_id'])
    )
    const first = make()
    const result = (await first.request('tools/call', {
      value: 'first',
      context: 'intent',
      llm_model: 'model-a',
    })) as any
    // A cold instance cannot prove the output key was advertised: clients
    // that read only structuredContent will miss the content-only handle.
    expect(result.structuredContent).toEqual(structured ? { ok: true } : undefined)
    if (structured) expect(discovery.tools[0].outputSchema.properties._mcp_instructions).toBeDefined()
    const handle = JSON.parse(result.content[1].text).conversation_id
    const second = make()
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
    // A fresh instance cannot prove it owns the analytics arguments, so it strips none of them.
    expect(first.received.mock.calls[0][0].params.arguments).toEqual({
      value: 'first',
      context: 'intent',
      llm_model: 'model-a',
    })
    expect(capture.findCapturesByEvent('$mcp_tools_list')).toHaveLength(1)
  })

  it('reads model and conversation handle on a cold instance without consulting the catalog', async () => {
    const server = fresh()
    const args = { value: 'v', llm_model: 'model-a', context: 'intent' }
    const result = (await server.request('tools/call', args)) as any
    expect(server.listing).not.toHaveBeenCalled()
    // Stripping requires positive ownership, which a cold instance never has.
    expect(server.received.mock.calls[0][0].params?.arguments).toEqual(args)
    expect(JSON.parse(result.content[1].text).conversation_id).toBeDefined()
    const event = capture.findCapturesByEvent('$mcp_tool_call')[0].properties
    expect(event.$mcp_llm_model).toBe('model-a')
    expect(event.$mcp_llm_model_source).toBe('self_reported')
    expect(event.$mcp_intent).toBe('intent')
    expect(event.$mcp_conversation_id).toBeDefined()
  })

  it.each(['transport', 'token'] as const)(
    'preserves a carried %s session until the agent echoes a handle',
    async (source) => {
      const server = fresh()
      const extra =
        source === 'transport'
          ? { sessionId: 'transport-session' }
          : { requestInfo: { headers: { 'mcp-session-id': encodeSessionId({ sessionId: 'ses_carried' }) } } }
      await server.request('tools/list', undefined, extra)
      for (let call = 0; call < 2; call++) {
        const result = (await server.request('tools/call', { value: 'v' }, extra)) as any
        expect(result.content).toHaveLength(1)
      }
      server.received.mockRejectedValueOnce(new Error('tool failed'))
      await expect(server.request('tools/call', { value: 'v' }, extra)).rejects.toThrow('tool failed')
      const expected = source === 'transport' ? deriveSessionIdFromMCPSession('transport-session') : 'ses_carried'
      expect(capture.findCapturesByEvent('$mcp_tools_list')[0].properties.$session_id).toBe(expected)
      for (const event of capture.findCapturesByEvent('$mcp_tool_call')) {
        expect(event.properties.$session_id).toBe(expected)
        expect(event.properties.$mcp_conversation_id).toBeUndefined()
      }
      const handle = '019fd2b0-4444-7444-8444-444444444444'
      await server.request('tools/call', { conversation_id: handle }, extra)
      expect(capture.findCapturesByEvent('$mcp_tool_call')[3].properties.$session_id).toBe(
        deriveSessionIdFromConversation(handle)
      )
    }
  )

  it('keeps explicit opt-outs inert', async () => {
    const server = fresh({ captureModel: false, enableConversationId: false, context: false })
    const result = (await server.request('tools/call', { value: 'v', llm_model: 'application-model' })) as any
    expect(server.listing).not.toHaveBeenCalled()
    expect(result.content).toHaveLength(1)
    expect(capture.findCapturesByEvent('$mcp_tool_call')[0].properties.$mcp_llm_model).toBeUndefined()
  })

  it.each([false, true])('preserves tool-owned analytics names, listed: %s', async (listed) => {
    const properties = Object.fromEntries(
      ['value', 'context', 'llm_model', 'conversation_id'].map((key) => [key, { type: 'string' }])
    )
    const server = fresh(undefined, properties)
    if (listed) await server.request('tools/list')
    const args = {
      value: 'v',
      context: 'application context',
      llm_model: 'application model',
      conversation_id: 'application conversation',
    }
    await server.request('tools/call', args)
    expect(server.received.mock.calls[0][0].params?.arguments).toEqual(args)
    const event = capture.findCapturesByEvent('$mcp_tool_call')[0].properties
    // Unresolved ownership reads fail open (ADR-0011): a cold instance records
    // the application's values under the analytics names; a listed one does not.
    expect(event.$mcp_llm_model).toBe(listed ? undefined : 'application model')
    expect(event.$mcp_intent).toBe(listed ? undefined : 'application context')
    // A non-uuidv7 handle is never trusted, so a cold instance mints one instead.
    expect(event.$mcp_conversation_id).toEqual(listed ? undefined : expect.any(String))
    expect(capture.findCapturesByEvent('$mcp_tools_list')).toHaveLength(listed ? 1 : 0)
  })
})
