import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { PostHogMCP, instrument } from '../index'
import { CLIENT_CONVERSATION_ROWS, recognizeClient } from '../extensions/client-conversation'
import { MCP_SESSION_HEADER, encodeSessionId } from '../extensions/session-token'
import type { CompatibleRequestHandlerExtra, MCPAnalyticsOptions, MCPServerLike } from '../types'
import { EventCapture, fakePostHog } from './test-utils'

/**
 * The client conversation ids of the spec's "Session identity" requirement: a
 * recognized client's own id in `params._meta` sets the session, ahead of any
 * handle or transport session. Every call lands on a fresh instance, as on a
 * per-request stateless server. Session ids below are the spec's vectors.
 */

const CHATGPT = 'openai-mcp/1.0.0 (ChatGPT)'
const CODEX = 'codex-mcp-client/0.50.0'
const OTHER = 'example-client/1.0'
const CHATGPT_ID = 'v1/conv-example-0001'
const CHATGPT_SESSION = 'ses_2f5d35b7108d17c807766f2f769a1e8c'
const CODEX_ID = '019A4F2E-1C3D-7B8A-9E0F-1A2B3C4D5E6F'
const CODEX_SESSION = 'ses_0fdf126b8e2c1f9689ca12f3dd3383e6'
const VSCODE_ID = '3f1c2b7e-8d4a-4c6b-9a1e-5f2d7c8b9a0e'
const VSCODE_SESSION = 'ses_0571acb894e6753d33e37e5c2b327c59'
const HANDLE = '0190f0e8-7a6b-7c3d-9e4f-5a6b7c8d9e0f'
const HANDLE_SESSION = 'ses_6df45f0102a182bcd5e8dd5dad6c65a0'
const VSCODE_CLIENT_META = {
  'io.modelcontextprotocol/clientInfo': { name: 'Visual Studio Code', version: '1.105.0' },
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
}

const handlerArgs: unknown[] = []

function createPod(options?: MCPAnalyticsOptions): MCPServerLike {
  const server = new Server({ name: 'pod', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: 'search_docs', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }],
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    handlerArgs.push(request.params.arguments)
    return { content: [{ type: 'text', text: 'docs' }] }
  })
  instrument(server, fakePostHog(), options)
  return server as unknown as MCPServerLike
}

interface CallInput {
  userAgent?: string
  meta?: Record<string, unknown>
  args?: Record<string, unknown>
  headers?: Record<string, string>
  extra?: CompatibleRequestHandlerExtra
  options?: MCPAnalyticsOptions
}

function requestExtra({ userAgent, headers, extra }: CallInput): CompatibleRequestHandlerExtra {
  return {
    ...extra,
    requestInfo: { headers: { ...(userAgent ? { 'user-agent': userAgent } : {}), ...headers } },
  } as CompatibleRequestHandlerExtra
}

async function callOnFreshPod(input: CallInput): Promise<{ content: unknown[] }> {
  const pod = createPod(input.options)
  const result = await pod._requestHandlers.get('tools/call')!(
    {
      method: 'tools/call',
      params: { name: 'search_docs', arguments: input.args ?? {}, ...(input.meta ? { _meta: input.meta } : {}) },
    },
    requestExtra(input)
  )
  await new Promise((resolve) => setTimeout(resolve, 25))
  return result as { content: unknown[] }
}

async function listOnFreshPod(userAgent: string): Promise<Record<string, unknown>> {
  const pod = createPod()
  const result = (await pod._requestHandlers.get('tools/list')!(
    { method: 'tools/list', params: {} },
    requestExtra({ userAgent })
  )) as { tools: { inputSchema: { properties: Record<string, unknown> } }[] }
  return result.tools[0].inputSchema.properties
}

const hasConversationIdBlock = (result: { content: unknown[] }): boolean =>
  JSON.stringify(result.content).includes('conversation_id')

describe('client conversation ids', () => {
  let capture: EventCapture

  beforeEach(async () => {
    handlerArgs.length = 0
    capture = new EventCapture()
    await capture.start()
  })

  afterEach(async () => {
    await capture.stop()
  })

  const toolCalls = (): Record<string, unknown>[] =>
    capture.findCapturesByEvent('$mcp_tool_call').map((event) => event.properties)

  it.each([{ enableConversationId: true }, { enableConversationId: false }])(
    'sets the session and adds no conversation_id block with %o',
    async (options) => {
      const results = [
        await callOnFreshPod({ userAgent: CHATGPT, meta: { 'openai/session': CHATGPT_ID }, options }),
        await callOnFreshPod({ userAgent: CHATGPT, meta: { 'openai/session': CHATGPT_ID }, options }),
      ]

      expect(results.map(hasConversationIdBlock)).toEqual([false, false])
      for (const call of toolCalls()) {
        expect(call.$session_id).toBe(CHATGPT_SESSION)
        expect(call.$mcp_session_source).toBe('client_metadata')
        expect(call).not.toHaveProperty('$mcp_conversation_id')
      }
    }
  )

  it.each([
    { name: 'a conversation handle', input: { args: { query: 'flags', conversation_id: HANDLE } } },
    {
      name: 'a replayed session token',
      input: { headers: { [MCP_SESSION_HEADER]: encodeSessionId({ sessionId: 'ses_token' }) } },
    },
    { name: 'a transport session id', input: { extra: { sessionId: 'transport-session' } } },
  ])('wins over $name', async ({ input }) => {
    await callOnFreshPod({ ...input, userAgent: CHATGPT, meta: { 'openai/session': CHATGPT_ID } })

    const [call] = toolCalls()
    expect(call.$session_id).toBe(CHATGPT_SESSION)
    expect(call.$mcp_session_source).toBe('client_metadata')
    expect(call).not.toHaveProperty('$mcp_conversation_id')
  })

  it('strips the handle it ignores before the handler runs', async () => {
    // Listing first proves the SDK owns `conversation_id` on this low-level server.
    const pod = createPod()
    const extra = requestExtra({ userAgent: CHATGPT })
    await pod._requestHandlers.get('tools/list')!({ method: 'tools/list', params: {} }, extra)
    await pod._requestHandlers.get('tools/call')!(
      {
        method: 'tools/call',
        params: {
          name: 'search_docs',
          arguments: { query: 'flags', conversation_id: HANDLE },
          _meta: { 'openai/session': CHATGPT_ID },
        },
      },
      extra
    )

    expect(handlerArgs).toEqual([{ query: 'flags' }])
  })

  it.each([
    { name: 'Codex by User-Agent', input: { userAgent: CODEX, meta: { sessionId: CODEX_ID } }, session: CODEX_SESSION },
    {
      name: 'Codex by client name',
      input: {
        meta: { sessionId: CODEX_ID, 'io.modelcontextprotocol/clientInfo': { name: 'codex-mcp-client' } },
      },
      session: CODEX_SESSION,
    },
    {
      name: 'VS Code by client name',
      input: { meta: { ...VSCODE_CLIENT_META, 'vscode.conversationId': VSCODE_ID } },
      session: VSCODE_SESSION,
    },
    {
      name: 'VS Code Insiders by User-Agent',
      input: { userAgent: 'Visual Studio Code - Insiders/1.106.0', meta: { 'vscode.conversationId': VSCODE_ID } },
      session: VSCODE_SESSION,
    },
  ])('sets the session from $name', async ({ input, session }) => {
    const result = await callOnFreshPod(input)

    expect(hasConversationIdBlock(result)).toBe(false)
    expect(toolCalls()[0].$session_id).toBe(session)
  })

  it.each([
    { name: 'not a UUID', meta: { sessionId: 'not-a-uuid' } },
    { name: 'the nil UUID', meta: { sessionId: '00000000-0000-0000-0000-000000000000' } },
    { name: 'absent', meta: undefined },
  ])('falls back to a handle when a Codex id is $name', async ({ meta }) => {
    const result = await callOnFreshPod({ userAgent: CODEX, meta })

    expect(hasConversationIdBlock(result)).toBe(true)
    expect(toolCalls()[0].$mcp_session_source).toBe('conversation')
  })

  it.each([
    { name: 'empty', meta: { 'openai/session': '' } },
    { name: 'longer than 128 characters', meta: { 'openai/session': 'x'.repeat(129) } },
    { name: 'not printable ASCII', meta: { 'openai/session': 'chat-é' } },
    { name: 'not a string', meta: { 'openai/session': 42 } },
    { name: 'absent', meta: undefined },
  ])('mints a handle-free client no handle when its id is $name', async ({ meta }) => {
    const results = [
      await callOnFreshPod({ userAgent: CHATGPT, meta }),
      await callOnFreshPod({ userAgent: CHATGPT, meta }),
    ]

    expect(results.map(hasConversationIdBlock)).toEqual([false, false])
    const [first, second] = toolCalls()
    expect(first.$session_id).not.toBe(second.$session_id)
    expect(first.$mcp_session_source).toBe('generated')
  })

  it('still counts a valid handle a handle-free client echoes', async () => {
    await callOnFreshPod({ userAgent: CHATGPT, args: { conversation_id: HANDLE } })

    expect(toolCalls()[0].$session_id).toBe(HANDLE_SESSION)
  })

  it('reads a key only from the client that defines it', async () => {
    const result = await callOnFreshPod({
      userAgent: OTHER,
      meta: { sessionId: CODEX_ID.toLowerCase(), 'openai/session': CHATGPT_ID },
    })

    expect(hasConversationIdBlock(result)).toBe(true)
    expect(toolCalls()[0].$session_id).not.toBe(CODEX_SESSION)
    expect(toolCalls()[0].$session_id).not.toBe(CHATGPT_SESSION)
  })

  it.each([
    { userAgent: CHATGPT, advertised: false },
    { userAgent: OTHER, advertised: true },
    { userAgent: CODEX, advertised: true },
  ])('advertises conversation_id to $userAgent: $advertised', async ({ userAgent, advertised }) => {
    const properties = await listOnFreshPod(userAgent)

    expect(properties).toHaveProperty('context')
    expect('conversation_id' in properties).toBe(advertised)
  })

  it.each([
    { userAgent: 'openai-mcp/1.0.0 (ChatGPT)', key: 'openai/session' },
    { userAgent: 'openai-mcp/1.0.0 ( chatgpt; web)', key: 'openai/session' },
    { userAgent: 'openai-mcp/1.0.0 (Codex)', key: undefined },
    { userAgent: 'openai-mcp/1.0.0 (ChatGPT-Agent)', key: undefined },
    { userAgent: 'Mozilla/5.0 openai-mcp/1.0.0 (ChatGPT)', key: undefined },
    { userAgent: 'CODEX-MCP-CLIENT/0.50.0', key: 'sessionId' },
    { userAgent: 'Visual Studio Code/1.105.0', key: 'vscode.conversationId' },
  ])('recognizes $userAgent as the $key row', ({ userAgent, key }) => {
    expect(recognizeClient({ userAgent })?.key).toBe(key)
  })

  it('checks rows in table order', () => {
    expect(recognizeClient({ userAgent: CHATGPT, clientName: 'codex-mcp-client' })).toBe(CLIENT_CONVERSATION_ROWS[0])
  })

  it.each([
    { name: 'keeps', gaps: [20, 20], rotated: false },
    { name: 'rotates', gaps: [40, 1], rotated: true },
  ])('$name a connection session across calls grouped by a client id', async ({ gaps, rotated }) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const pod = createPod({ enableConversationId: false })
      const call = async (meta?: Record<string, unknown>): Promise<void> => {
        await pod._requestHandlers.get('tools/call')!(
          { method: 'tools/call', params: { name: 'search_docs', arguments: {}, ...(meta ? { _meta: meta } : {}) } },
          requestExtra({ userAgent: CODEX })
        )
      }
      await call()
      vi.advanceTimersByTime(gaps[0] * 60_000)
      await call({ sessionId: CODEX_ID })
      vi.advanceTimersByTime(gaps[1] * 60_000)
      await call()
      vi.useRealTimers()
      await new Promise((resolve) => setTimeout(resolve, 25))

      const [first, grouped, last] = toolCalls()
      expect(grouped.$session_id).toBe(CODEX_SESSION)
      expect(last.$mcp_session_source).toBe('generated')
      expect(last.$session_id === first.$session_id).toBe(!rotated)
    } finally {
      vi.useRealTimers()
    }
  })

  it('records the instance session source on custom events', async () => {
    const analytics = instrument(new Server({ name: 'pod', version: '1.0.0' }, { capabilities: {} }), fakePostHog())
    await analytics.capture({ event: 'custom_thing' })

    const [captured] = capture.findCapturesByEvent('custom_thing')
    expect(captured.properties.$mcp_session_source).toBe('generated')
  })

  describe('PostHogMCP', () => {
    const client = new PostHogMCP('phc_test', { host: 'http://localhost', fetchRetryCount: 0 })

    afterAll(async () => {
      await client.shutdown()
    })

    it.each([
      {
        name: 'a ChatGPT id over a carried session',
        options: {
          headers: { 'user-agent': CHATGPT },
          requestMeta: { 'openai/session': CHATGPT_ID },
          sessionId: 'ses_x',
        },
        expected: { sessionId: CHATGPT_SESSION, minted: false },
      },
      {
        name: 'a Codex id from the bound handshake',
        options: { clientInfo: { name: 'codex-mcp-client' }, requestMeta: { sessionId: CODEX_ID } },
        expected: { sessionId: CODEX_SESSION, minted: false },
      },
      {
        name: 'no handle for a handle-free client without its id',
        options: { headers: { 'user-agent': CHATGPT } },
        expected: { sessionId: undefined, minted: false },
      },
      {
        name: 'a ChatGPT key without its User-Agent',
        options: { requestMeta: { 'openai/session': CHATGPT_ID } },
        expected: { sessionId: 'minted', minted: true },
      },
      {
        name: 'a carried session',
        options: { headers: { 'user-agent': CHATGPT }, sessionId: 'ses_carried' },
        expected: { sessionId: 'ses_carried', minted: false },
      },
    ])('prepareToolCall resolves $name', ({ options, expected }) => {
      const call = client.prepareToolCall('search_docs', {}, options)
      const prepared = client.prepareToolResult({ content: [] }, call)

      expect(hasConversationIdBlock(prepared.result)).toBe(expected.minted)
      if (expected.sessionId !== 'minted') {
        expect(prepared.sessionId).toBe(expected.sessionId)
        expect(prepared.conversationId).toBeUndefined()
      }
    })

    it.each([
      { name: 'its User-Agent', data: { clientUserAgent: CHATGPT }, expected: CHATGPT_SESSION },
      { name: 'nothing that recognizes the client', data: {}, expected: 'ses_caller' },
    ])('captureToolCall applies a client conversation id with $name', async ({ data, expected }) => {
      client.captureToolCall({
        ...data,
        toolName: 'search_docs',
        sessionId: 'ses_caller',
        conversationId: HANDLE,
        requestMeta: { 'openai/session': CHATGPT_ID },
      })
      await client.flush()

      const [call] = toolCalls()
      expect(call.$session_id).toBe(expected)
      expect('$mcp_conversation_id' in call).toBe(expected !== CHATGPT_SESSION)
    })

    it.each([
      { userAgent: CHATGPT, advertised: false },
      { userAgent: OTHER, advertised: true },
    ])('prepareToolList advertises conversation_id to $userAgent: $advertised', ({ userAgent, advertised }) => {
      const [tool] = client.prepareToolList(
        [{ name: 'search_docs', inputSchema: { type: 'object', properties: {} } }],
        {
          headers: { 'user-agent': userAgent },
        }
      )

      expect('conversation_id' in (tool.inputSchema as { properties: object }).properties).toBe(advertised)
    })
  })
})
