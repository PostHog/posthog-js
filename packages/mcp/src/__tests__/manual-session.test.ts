import { PostHogMCP } from '../index'
import { deriveSessionIdFromMCPSession } from '../extensions/session'
import { encodeSessionId } from '../extensions/session-token'
import type { PrepareToolCallOptions } from '../types'
import { EventCapture } from './test-utils'

/**
 * The step path of the spec's "Manual capture" requirement resolves `$session_id`
 * and `$mcp_session_source` the way automatic instrumentation does, from the
 * request's `_meta`, headers, transport session, or a one-client connection key.
 */

const CHATGPT = 'openai-mcp/1.0.0 (ChatGPT)'
const CHATGPT_SESSION = 'ses_2f5d35b7108d17c807766f2f769a1e8c'
const HANDLE = '0190f0e8-7a6b-7c3d-9e4f-5a6b7c8d9e0f'
const HANDLE_SESSION = 'ses_6df45f0102a182bcd5e8dd5dad6c65a0'
const SESSION_PATTERN = /^ses_[0-9a-f-]+$/

interface Step {
  args?: Record<string, unknown>
  options?: PrepareToolCallOptions
  result?: unknown
  minutes?: number
}

describe('PostHogMCP step-path sessions', () => {
  let events: EventCapture
  let client: PostHogMCP

  beforeEach(async () => {
    events = new EventCapture()
    await events.start()
    client = new PostHogMCP('phc_test', { host: 'http://localhost', fetchRetryCount: 0 })
    client.prepareToolList([{ name: 'search_docs', inputSchema: { type: 'object', properties: {} } }])
  })

  afterEach(async () => {
    vi.useRealTimers()
    await client.shutdown()
    await events.stop()
  })

  async function call({ args = {}, options = {}, result = { content: [] }, minutes = 0 }: Step = {}): Promise<void> {
    const prepared = client.prepareToolCall('search_docs', args, options)
    if (minutes > 0) {
      vi.advanceTimersByTime(minutes * 60_000)
    }
    const { sessionId, sessionSource, conversationId } = client.prepareToolResult(result, prepared)
    client.captureToolCall({ toolName: 'search_docs', sessionId, sessionSource, conversationId })
  }

  async function toolCalls(): Promise<Record<string, unknown>[]> {
    await client.flush()
    await new Promise((resolve) => setTimeout(resolve, 10))
    return events.findCapturesByEvent('$mcp_tool_call').map((event) => event.properties)
  }

  it.each([
    {
      name: 'a transport session id, hashed',
      step: { options: { sessionId: 'transport-session' } },
      session: deriveSessionIdFromMCPSession('transport-session'),
      source: 'transport',
    },
    {
      name: 'a replayed PostHog session token, as its sid',
      step: { options: { sessionId: encodeSessionId({ sessionId: 'ses_first' }) } },
      session: 'ses_first',
      source: 'transport',
    },
    {
      name: 'an echoed handle over a transport session',
      step: { args: { conversation_id: HANDLE }, options: { sessionId: 'transport-session' } },
      session: HANDLE_SESSION,
      source: 'conversation',
    },
    {
      name: 'a client conversation id over a handle',
      step: {
        args: { conversation_id: HANDLE },
        options: { headers: { 'user-agent': CHATGPT }, requestMeta: { 'openai/session': 'v1/conv-example-0001' } },
      },
      session: CHATGPT_SESSION,
      source: 'client_metadata',
    },
    {
      name: 'nothing from a handle-free client, as a fresh id',
      step: { options: { headers: { 'user-agent': CHATGPT } } },
      session: SESSION_PATTERN,
      source: 'generated',
    },
  ])('records $name', async ({ step, session, source }) => {
    await call(step)

    const [event] = await toolCalls()
    if (session instanceof RegExp) {
      expect(event.$session_id).toMatch(session)
    } else {
      expect(event.$session_id).toBe(session)
    }
    expect(event.$mcp_session_source).toBe(source)
  })

  it.each([
    { name: 'without a connection key', options: {} },
    { name: 'on a one-client connection', options: { connectionKey: 'stdio-1' } },
  ])('does not use an undelivered minted handle for the session $name', async ({ options }) => {
    await call({ options: { connectionKey: 'stdio-1' }, result: { value: 1 } })
    await call({ options, result: { value: 1 } })

    const [first, undelivered] = await toolCalls()
    expect(undelivered).not.toHaveProperty('$mcp_conversation_id')
    expect(undelivered.$mcp_session_source).toBe('generated')
    expect(undelivered.$session_id).toMatch(SESSION_PATTERN)
    expect(undelivered.$session_id === first.$session_id).toBe('connectionKey' in options)
  })

  it.each([
    { name: 'keeps the session 29 minutes after a call', calls: [0, 0], gaps: [29], same: true },
    { name: 'rotates at exactly 30 minutes', calls: [0, 0], gaps: [30], same: false },
    { name: 'measures the gap from when the previous call ended', calls: [20, 0], gaps: [15], same: true },
  ])('$name on a one-client connection', async ({ calls, gaps, same }) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const options = { connectionKey: 'stdio-1' }
    await call({ options, minutes: calls[0], result: { value: 1 } })
    vi.advanceTimersByTime(gaps[0] * 60_000)
    await call({ options, minutes: calls[1], result: { value: 1 } })
    vi.useRealTimers()

    const [first, second] = await toolCalls()
    expect(second.$mcp_session_source).toBe('generated')
    expect(second.$session_id === first.$session_id).toBe(same)
  })

  it('keeps one session per connection key', async () => {
    await call({ options: { connectionKey: 'stdio-1' }, result: { value: 1 } })
    await call({ options: { connectionKey: 'stdio-2' }, result: { value: 1 } })
    await call({ options: { connectionKey: 'stdio-1' }, result: { value: 1 } })

    const [first, other, again] = await toolCalls()
    expect(again.$session_id).toBe(first.$session_id)
    expect(other.$session_id).not.toBe(first.$session_id)
  })

  describe('on a one-client connection', () => {
    const stdio = { connectionKey: 'stdio-1' }
    const undelivered = { value: 1 }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
    })

    const minutes = (count: number): void => {
      vi.advanceTimersByTime(count * 60_000)
    }

    it('holds the session open while an earlier call is still running', async () => {
      const running = client.prepareToolCall('search_docs', {}, stdio)
      minutes(35)
      await call({ options: stdio, result: undelivered })
      minutes(5)
      const ended = client.prepareToolResult(undelivered, running)
      client.captureToolCall({ toolName: 'search_docs', ...ended })

      const [during, first] = await toolCalls()
      expect(during.$session_id).toBe(first.$session_id)
    })

    it("keeps a running call's connection when another connection arrives", async () => {
      const running = client.prepareToolCall('search_docs', {}, stdio)
      minutes(31)
      await call({ options: { connectionKey: 'stdio-2' }, result: undelivered })
      minutes(9)
      const ended = client.prepareToolResult(undelivered, running)
      client.captureToolCall({ toolName: 'search_docs', ...ended })
      minutes(1)
      await call({ options: stdio, result: undelivered })

      const [, first, next] = await toolCalls()
      expect(next.$session_id).toBe(first.$session_id)
    })

    it.each([
      { name: 'a transport session', options: { sessionId: 'mcp-transport-abc' }, source: 'transport' },
      { name: 'a connection key', options: stdio, source: 'generated' },
    ])('gives initialize and listing events the tool call session for $name', async ({ options, source }) => {
      client.captureInitialize({ ...client.resolveSession(options), clientName: 'x', clientVersion: '1' })
      client.captureToolsList({ ...client.resolveSession(options), toolNames: ['search_docs'] })
      await call({ options, result: undelivered })
      await client.flush()
      await new Promise((resolve) => setTimeout(resolve, 10))

      const sessions = ['$mcp_initialize', '$mcp_tools_list', '$mcp_tool_call'].map(
        (event) => events.findCapturesByEvent(event)[0].properties
      )
      expect(new Set(sessions.map((properties) => properties.$session_id)).size).toBe(1)
      expect(sessions.map((properties) => properties.$mcp_session_source)).toEqual([source, source, source])
    })

    it('neither rotates nor refreshes the session when resolved outside a tool call', async () => {
      await call({ options: stdio, result: undelivered })
      minutes(40)
      const listed = client.resolveSession(stdio)
      await call({ options: stdio, result: undelivered })

      const [first, next] = await toolCalls()
      expect(listed.sessionId).toBe(first.$session_id)
      expect(next.$session_id).not.toBe(first.$session_id)
    })
  })
})
