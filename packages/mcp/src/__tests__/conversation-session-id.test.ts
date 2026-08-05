import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrument } from '../index'
import { deterministicPrefixedId } from '../extensions/ids'
import { MCP_SESSION_HEADER, encodeSessionId } from '../extensions/session-token'
import { getServerTrackingData } from '../extensions/internal'
import { getSessionId } from '../extensions/session'
import type { HighLevelMCPServerLike, MCPServerLike } from '../types'
import { EventCapture, fakePostHog } from './test-utils'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'

/**
 * The conversation handle as the session anchor: when a tool call carries a
 * `conversation_id`, `$session_id` derives from it instead of from the transport.
 * This is what lets calls correlate across reconnects, restarts, and the
 * per-request server instances the MCP 2026-07-28 revision introduces.
 */
/** Shaped like a handle we would have minted, so it is echoed rather than replaced. */
const CONVERSATION_HANDLE = '019fd2b0-4444-7444-8444-444444444444'

describe('conversation_id as the session anchor', () => {
  let server: HighLevelMCPServerLike
  let client: any
  let cleanup: () => Promise<void>
  let capture: EventCapture

  beforeEach(async () => {
    resetTodos()
    const setup = await setupTestServerAndClient()
    server = setup.server
    client = setup.client
    cleanup = setup.cleanup
    capture = new EventCapture()
    await capture.start()
  })

  afterEach(async () => {
    await capture.stop()
    await cleanup()
  })

  /** Runs a tool call, optionally carrying a conversation handle. */
  async function callTool(text: string, conversationId?: string): Promise<void> {
    await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'add_todo',
          arguments: conversationId === undefined ? { text } : { text, conversation_id: conversationId },
        },
      },
      CallToolResultSchema
    )
    // The capture pipeline runs after the handler returns.
    await new Promise((r) => setTimeout(r, 50))
  }

  function toolCallSessionIds(): string[] {
    return capture
      .getEvents()
      .filter((e) => e.resourceName === 'add_todo')
      .map((e) => e.sessionId)
  }

  describe('getSessionId', () => {
    it('derives the session id from the conversation id when one is supplied', () => {
      instrument(server, fakePostHog())
      const lowLevel = server.server as MCPServerLike

      const derived = getSessionId(lowLevel, undefined, 'conversation-abc')

      expect(derived).toMatch(/^ses_/)
      expect(derived).not.toBe(getSessionId(lowLevel, undefined))
    })

    it('is deterministic — the same handle always yields the same session id', () => {
      instrument(server, fakePostHog())
      const lowLevel = server.server as MCPServerLike

      expect(getSessionId(lowLevel, undefined, 'conversation-abc')).toBe(
        getSessionId(lowLevel, undefined, 'conversation-abc')
      )
    })

    it('maps different handles to different session ids', () => {
      instrument(server, fakePostHog())
      const lowLevel = server.server as MCPServerLike

      expect(getSessionId(lowLevel, undefined, 'conversation-a')).not.toBe(
        getSessionId(lowLevel, undefined, 'conversation-b')
      )
    })

    it('leaves the in-memory session untouched, so a handle cannot leak across chats', () => {
      instrument(server, fakePostHog())
      const lowLevel = server.server as MCPServerLike
      const data = getServerTrackingData(lowLevel)!
      const before = data.sessionId

      getSessionId(lowLevel, undefined, 'conversation-abc')

      // A concurrent request with no handle must still see the original session.
      expect(data.sessionId).toBe(before)
      expect(getSessionId(lowLevel, undefined)).toBe(before)
    })

    it('falls back to the existing resolution when no handle is supplied', () => {
      instrument(server, fakePostHog())
      const lowLevel = server.server as MCPServerLike
      const data = getServerTrackingData(lowLevel)!

      expect(getSessionId(lowLevel, undefined, undefined)).toBe(data.sessionId)
    })
  })

  describe('identity', () => {
    it('still announces $identify for a handle-anchored session on a token deployment', async () => {
      instrument(server, fakePostHog(), {
        enableConversationId: true,
        identify: async () => ({ distinctId: 'user-1' }),
      })

      // A replayed token leaves data.sessionSource === 'token', which is what
      // suppresses a second $identify. A handle-anchored session is a brand new
      // session nobody announced, so suppressing it would lose the event entirely
      // on exactly the stateless deployments this feature targets.
      const lowLevel = server.server as MCPServerLike
      getServerTrackingData(lowLevel)!.sessionSource = 'token'
      const callHandler = lowLevel._requestHandlers.get('tools/call')!
      const extra: any = {
        requestInfo: {
          headers: { [MCP_SESSION_HEADER]: encodeSessionId({ sessionId: 'ses_from_token', clientName: 'c' }) },
        },
      }

      for (const handle of ['019fd2b0-aaaa-7aaa-8aaa-aaaaaaaaaaaa', '019fd2b0-bbbb-7bbb-8bbb-bbbbbbbbbbbb']) {
        await callHandler(
          { method: 'tools/call', params: { name: 'add_todo', arguments: { text: 't', conversation_id: handle } } },
          extra
        )
      }
      await new Promise((r) => setTimeout(r, 60))

      expect(capture.findCapturesByEvent('$identify')).toHaveLength(2)
    })
  })

  describe('across server instances', () => {
    it('produces the same session id from the same handle with no shared state', async () => {
      instrument(server, fakePostHog())

      const other = await setupTestServerAndClient()
      instrument(other.server, fakePostHog())

      try {
        const fromA = getSessionId(server.server as MCPServerLike, undefined, 'shared-conversation')
        const fromB = getSessionId(other.server.server as MCPServerLike, undefined, 'shared-conversation')

        // The cross-pod property: two processes that never met agree on the session.
        expect(fromA).toBe(fromB)
      } finally {
        await other.cleanup()
      }
    })

    it('does not merge two callers that invent the same conversation_id', async () => {
      // The flip side of the property above. Agreement across pods is the whole
      // point, so it cannot be weakened here — the guard is upstream, in
      // resolveConversationId, which refuses to anchor on a handle it could not
      // have minted. Without it, two unrelated users both sending `conv-1` share
      // a session, and the data looks fine while being wrong.
      instrument(server, fakePostHog(), { enableConversationId: true })

      const other = await setupTestServerAndClient()
      instrument(other.server, fakePostHog(), { enableConversationId: true })

      try {
        const invented = 'conv-1'
        await callTool('from a', invented)
        await other.client.request(
          {
            method: 'tools/call',
            params: { name: 'add_todo', arguments: { text: 'from b', conversation_id: invented } },
          },
          CallToolResultSchema
        )
        await new Promise((r) => setTimeout(r, 60))

        const sessions = new Set(capture.getCaptures().map((c: any) => c.properties.$session_id))
        expect(sessions.size).toBe(2)
        expect(sessions).not.toContain(deterministicPrefixedId('ses', invented))
      } finally {
        await other.cleanup()
      }
    })
  })

  describe('tool calls', () => {
    it('groups calls sharing a conversation id into one session', async () => {
      instrument(server, fakePostHog(), { enableConversationId: true })

      await callTool('first', CONVERSATION_HANDLE)
      await callTool('second', CONVERSATION_HANDLE)

      // Assert the derived value, not just that the two agree — they would also
      // agree on the transport session id if the handle were ignored entirely.
      const expected = deterministicPrefixedId('ses', CONVERSATION_HANDLE)
      expect(toolCallSessionIds()).toEqual([expected, expected])
    })

    it('separates calls carrying different conversation ids', async () => {
      instrument(server, fakePostHog(), { enableConversationId: true })

      // Both handles must be minted-shaped, or the shape check replaces them and
      // the two sessions differ because *minting* produced two ids — not because
      // the two supplied handles did. Assert the derived values for the same
      // reason as the test above: `not.toBe` alone cannot tell those apart.
      const a = '019fd2b0-1111-7111-8111-111111111111'
      const b = '019fd2b0-2222-7222-8222-222222222222'
      await callTool('first', a)
      await callTool('second', b)

      expect(toolCallSessionIds()).toEqual([deterministicPrefixedId('ses', a), deterministicPrefixedId('ses', b)])
    })

    it('stamps both $session_id and $mcp_conversation_id on the payload', async () => {
      instrument(server, fakePostHog(), { enableConversationId: true })

      await callTool('first', CONVERSATION_HANDLE)

      const [payload] = capture.findCapturesByEvent('$mcp_tool_call')
      expect(payload.properties.$session_id).toBe(deterministicPrefixedId('ses', CONVERSATION_HANDLE))
      expect(payload.properties.$mcp_conversation_id).toBe(CONVERSATION_HANDLE)
      // Deliberately distinct values: one is the grouping key, the other the raw handle.
      expect(payload.properties.$session_id).not.toBe(payload.properties.$mcp_conversation_id)
    })

    it('keeps the transport session when the feature is off', async () => {
      instrument(server, fakePostHog(), { enableConversationId: false })
      const data = getServerTrackingData(server.server as MCPServerLike)!

      // The argument is the host's own, not ours, when injection is disabled.
      await callTool('first', CONVERSATION_HANDLE)

      expect(toolCallSessionIds()[0]).toBe(data.sessionId)
    })

    it('reuses the minted handle across calls once the agent echoes it back', async () => {
      instrument(server, fakePostHog(), { enableConversationId: true })

      // First call omits the handle, so the SDK mints one and prompts for it.
      await callTool('first')
      const minted = capture.getEvents().find((e) => e.resourceName === 'add_todo')?.conversationId
      expect(minted).toBeDefined()

      await callTool('second', minted)

      const expected = deterministicPrefixedId('ses', minted!)
      expect(toolCallSessionIds()).toEqual([expected, expected])
    })
  })
})
