import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { PostHogMCP, instrument } from '../index'
import { deriveSessionIdFromClientConversation } from '../extensions/session'
import { MCP_SESSION_HEADER, encodeSessionId } from '../extensions/session-token'
import type { CompatibleRequestHandlerExtra, MCPAnalyticsOptions, MCPServerLike } from '../types'
import { EventCapture, fakePostHog } from './test-utils'

/**
 * A host client's own conversation id in `params._meta` (ChatGPT's
 * `openai/session`) groups a stateless client's calls without touching tool
 * schemas or results. Every call lands on a fresh instance, as on a
 * per-request stateless server.
 */

const CHATGPT_SESSION = 'v1/aBcDeF123'
const HANDLE = '019fd2b0-4444-7444-8444-444444444444'

function createPod(options?: MCPAnalyticsOptions): MCPServerLike {
  const server = new Server({ name: 'pod', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: 'get_plan', inputSchema: { type: 'object', properties: {} } }],
  }))
  server.setRequestHandler(CallToolRequestSchema, async () => ({
    content: [{ type: 'text', text: 'plan: enterprise' }],
  }))
  instrument(server, fakePostHog(), options)
  return server as unknown as MCPServerLike
}

interface CallInput {
  meta?: Record<string, unknown>
  args?: Record<string, unknown>
  extra?: CompatibleRequestHandlerExtra
  options?: MCPAnalyticsOptions
}

async function callOnFreshPod({ meta, args = {}, extra, options }: CallInput): Promise<{ content: unknown[] }> {
  const pod = createPod(options)
  const handler = pod._requestHandlers.get('tools/call')!
  const result = await handler(
    { method: 'tools/call', params: { name: 'get_plan', arguments: args, ...(meta ? { _meta: meta } : {}) } },
    extra
  )
  await new Promise((resolve) => setTimeout(resolve, 25))
  return result as { content: unknown[] }
}

describe('client-supplied conversation id', () => {
  let capture: EventCapture

  beforeEach(async () => {
    capture = new EventCapture()
    await capture.start()
  })

  afterEach(async () => {
    await capture.stop()
  })

  const toolCalls = (): Record<string, unknown>[] =>
    capture.findCapturesByEvent('$mcp_tool_call').map((event) => event.properties)

  it.each([{ enableConversationId: true }, { enableConversationId: false }])(
    'groups calls on fresh instances and leaves results unchanged with %o',
    async (options) => {
      const results = [
        await callOnFreshPod({ meta: { 'openai/session': CHATGPT_SESSION }, options }),
        await callOnFreshPod({ meta: { 'openai/session': CHATGPT_SESSION }, options }),
      ]

      const [first, second] = toolCalls()
      expect(first.$session_id).toBe(deriveSessionIdFromClientConversation('openai/session', CHATGPT_SESSION))
      expect(second.$session_id).toBe(first.$session_id)
      expect(first.$mcp_session_source).toBe('client_metadata')
      expect(first.$mcp_conversation_id).toBeUndefined()
      expect(results.map((result) => result.content)).toEqual([
        [{ type: 'text', text: 'plan: enterprise' }],
        [{ type: 'text', text: 'plan: enterprise' }],
      ])
    }
  )

  it.each([
    { method: 'tools/list', params: {}, event: '$mcp_tools_list' },
    {
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ChatGPT', version: '1' } },
      event: '$mcp_initialize',
    },
  ])('groups $method by the client conversation id', async ({ method, params, event }) => {
    const pod = createPod()
    await pod._requestHandlers.get(method)!({
      method,
      params: { ...params, _meta: { 'openai/session': CHATGPT_SESSION } },
    })
    await new Promise((resolve) => setTimeout(resolve, 25))

    const [captured] = capture.findCapturesByEvent(event)
    expect(captured.properties.$session_id).toBe(
      deriveSessionIdFromClientConversation('openai/session', CHATGPT_SESSION)
    )
    expect(captured.properties.$mcp_session_source).toBe('client_metadata')
  })

  it('records the instance session source on custom events', async () => {
    const analytics = instrument(new Server({ name: 'pod', version: '1.0.0' }, { capabilities: {} }), fakePostHog())
    await analytics.capture({ event: 'custom_thing' })

    const [captured] = capture.findCapturesByEvent('custom_thing')
    expect(captured.properties.$mcp_session_source).toBe('generated')
  })

  it('separates different client conversations', async () => {
    await callOnFreshPod({ meta: { 'openai/session': 'chat-a' } })
    await callOnFreshPod({ meta: { 'openai/session': 'chat-b' } })

    const [first, second] = toolCalls()
    expect(first.$session_id).not.toBe(second.$session_id)
  })

  it.each([
    {
      name: 'an echoed conversation handle',
      input: { args: { conversation_id: HANDLE } },
      source: 'conversation',
    },
    {
      name: 'a replayed session token',
      input: {
        extra: { requestInfo: { headers: { [MCP_SESSION_HEADER]: encodeSessionId({ sessionId: 'ses_token' }) } } },
      },
      source: 'transport',
    },
    {
      name: 'a transport session id',
      input: { extra: { sessionId: 'transport-session' } },
      source: 'transport',
    },
  ])('keeps $name ahead of the client conversation id', async ({ input, source }) => {
    await callOnFreshPod({ ...input, meta: { 'openai/session': CHATGPT_SESSION } })

    const [call] = toolCalls()
    expect(call.$session_id).not.toBe(deriveSessionIdFromClientConversation('openai/session', CHATGPT_SESSION))
    expect(call.$mcp_session_source).toBe(source)
  })

  it.each([
    { name: 'absent', meta: undefined },
    { name: 'empty', meta: { 'openai/session': '' } },
    { name: 'not a string', meta: { 'openai/session': 42 } },
    { name: 'longer than 256 characters', meta: { 'openai/session': 'x'.repeat(257) } },
    { name: 'not printable ASCII', meta: { 'openai/session': 'chat-é' } },
    { name: 'an unrecognized key', meta: { sessionId: CHATGPT_SESSION } },
  ])('ignores a client conversation id that is $name', async ({ meta }) => {
    await callOnFreshPod({ meta, options: { enableConversationId: false } })
    await callOnFreshPod({ meta, options: { enableConversationId: false } })

    const [first, second] = toolCalls()
    expect(first.$session_id).not.toBe(second.$session_id)
    expect(first.$mcp_session_source).toBe('generated')
  })

  it('still mints a handle when the client sends no conversation id', async () => {
    const result = await callOnFreshPod({})

    expect(JSON.stringify(result.content)).toContain('conversation_id')
    expect(toolCalls()[0].$mcp_session_source).toBe('conversation')
  })

  it('derives the session id identically across SDKs', () => {
    expect(deriveSessionIdFromClientConversation('openai/session', CHATGPT_SESSION)).toBe(
      'ses_35e4cc45ea3e5e1282c3f091de632132'
    )
  })

  describe('PostHogMCP.prepareToolCall', () => {
    const client = new PostHogMCP('phc_test', { host: 'http://localhost', fetchRetryCount: 0 })

    afterAll(async () => {
      await client.shutdown()
    })

    it.each([
      {
        name: 'groups by the client conversation id without minting a handle',
        options: { requestMeta: { 'openai/session': CHATGPT_SESSION } },
        args: {},
        expected: deriveSessionIdFromClientConversation('openai/session', CHATGPT_SESSION),
      },
      {
        name: 'keeps a carried session ahead of the client conversation id',
        options: { requestMeta: { 'openai/session': CHATGPT_SESSION }, sessionId: 'ses_carried' },
        args: {},
        expected: 'ses_carried',
      },
      {
        name: 'treats an empty carried session as absent',
        options: { requestMeta: { 'openai/session': CHATGPT_SESSION }, sessionId: '' },
        args: {},
        expected: deriveSessionIdFromClientConversation('openai/session', CHATGPT_SESSION),
      },
    ])('$name', ({ options, args, expected }) => {
      const call = client.prepareToolCall('get_plan', args, options)
      const prepared = client.prepareToolResult({ content: [] }, call)

      expect(prepared.sessionId).toBe(expected)
      expect(prepared.conversationId).toBeUndefined()
      expect(prepared.result).toEqual({ content: [] })
    })
  })
})
