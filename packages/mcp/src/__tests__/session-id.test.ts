import { instrument } from '../index'
import { getServerTrackingData } from '../extensions/internal'
import { deriveSessionIdFromMCPSession, getSessionId } from '../extensions/session'
import { MCP_SESSION_HEADER, encodeSessionId } from '../extensions/session-token'
import type { HighLevelMCPServerLike } from '../types'
import { EventCapture, fakePostHog } from './test-utils'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'

const SESSION_ID_PATTERN = /^ses_/

describe('Session ID Management', () => {
  let server: HighLevelMCPServerLike
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    resetTodos()
    const setup = await setupTestServerAndClient()
    server = setup.server
    cleanup = setup.cleanup
  })

  afterEach(async () => {
    await cleanup()
  })

  describe('Deterministic MCP session ID derivation', () => {
    it('should generate deterministic session IDs from the same MCP sessionId', () => {
      const mcpSessionId = 'test-session-123'

      const sessionId1 = deriveSessionIdFromMCPSession(mcpSessionId)
      const sessionId2 = deriveSessionIdFromMCPSession(mcpSessionId)

      expect(sessionId1).toBe(sessionId2)
      expect(sessionId1).toMatch(SESSION_ID_PATTERN)
    })

    it('should generate different session IDs for different MCP sessionIds', () => {
      const sessionId1 = deriveSessionIdFromMCPSession('session-1')
      const sessionId2 = deriveSessionIdFromMCPSession('session-2')

      expect(sessionId1).not.toBe(sessionId2)
      expect(sessionId1).toMatch(SESSION_ID_PATTERN)
      expect(sessionId2).toMatch(SESSION_ID_PATTERN)
    })

    it('should not require project secrets to derive session IDs', () => {
      expect(deriveSessionIdFromMCPSession('test-session-123')).toMatch(SESSION_ID_PATTERN)
    })
  })

  describe('MCP SessionId Prioritization', () => {
    it('should use MCP sessionId when provided in extra parameter', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()
      const mcpSessionId = 'mcp-session-abc-123'

      instrument(server, fakePostHog())

      // Get the low-level server
      const lowLevelServer = server.server

      // Simulate MCP sessionId in extra parameter
      const extra = { sessionId: mcpSessionId }

      // Get session ID with MCP sessionId provided
      const sessionId = getSessionId(lowLevelServer, extra)

      // Verify it's deterministically derived
      const expectedSessionId = deriveSessionIdFromMCPSession(mcpSessionId)
      expect(sessionId).toBe(expectedSessionId)

      // Verify tracking data is updated
      const data = getServerTrackingData(lowLevelServer)
      expect(data?.sessionSource).toBe('mcp')

      await eventCapture.stop()
    })

    it('should use PostHog MCP analytics-generated sessionId when no MCP sessionId provided', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      instrument(server, fakePostHog())

      const lowLevelServer = server.server

      // Get initial session ID without MCP sessionId
      const sessionId1 = getSessionId(lowLevelServer)
      expect(sessionId1).toMatch(SESSION_ID_PATTERN)

      // Verify tracking data shows PostHog MCP analytics source
      const data = getServerTrackingData(lowLevelServer)
      expect(data?.sessionSource).toBe('generated')

      // Get session ID again - should be the same
      const sessionId2 = getSessionId(lowLevelServer)
      expect(sessionId2).toBe(sessionId1)

      await eventCapture.stop()
    })

    it('should switch to MCP-derived sessionId when MCP sessionId appears', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()
      const mcpSessionId = 'mcp-session-appears'

      instrument(server, fakePostHog())

      const lowLevelServer = server.server

      // Start with no MCP sessionId
      const generatedSessionId = getSessionId(lowLevelServer)
      expect(generatedSessionId).toMatch(SESSION_ID_PATTERN)

      let data = getServerTrackingData(lowLevelServer)
      expect(data?.sessionSource).toBe('generated')

      // Now provide MCP sessionId
      const extra = { sessionId: mcpSessionId }
      const mcpDerivedSessionId = getSessionId(lowLevelServer, extra)

      // Verify it switched to MCP-derived ID
      const expectedSessionId = deriveSessionIdFromMCPSession(mcpSessionId)
      expect(mcpDerivedSessionId).toBe(expectedSessionId)
      expect(mcpDerivedSessionId).not.toBe(generatedSessionId)

      // Verify tracking data is updated
      data = getServerTrackingData(lowLevelServer)
      expect(data?.sessionSource).toBe('mcp')

      await eventCapture.stop()
    })

    it('should keep last derived sessionId when MCP sessionId disappears', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()
      const mcpSessionId = 'mcp-session-disappears'

      instrument(server, fakePostHog())

      const lowLevelServer = server.server

      // Provide MCP sessionId
      const extra = { sessionId: mcpSessionId }
      const mcpDerivedSessionId = getSessionId(lowLevelServer, extra)

      const expectedSessionId = deriveSessionIdFromMCPSession(mcpSessionId)
      expect(mcpDerivedSessionId).toBe(expectedSessionId)

      // Now call without MCP sessionId (it disappeared)
      const sessionIdAfterDisappear = getSessionId(lowLevelServer)

      // Should keep using the last derived sessionId
      expect(sessionIdAfterDisappear).toBe(mcpDerivedSessionId)

      // Verify tracking data still shows MCP source
      const data = getServerTrackingData(lowLevelServer)
      expect(data?.sessionSource).toBe('mcp')

      await eventCapture.stop()
    })

    it('should regenerate sessionId when MCP sessionId changes', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()
      const mcpSessionId1 = 'mcp-session-first'
      const mcpSessionId2 = 'mcp-session-second'

      instrument(server, fakePostHog())

      const lowLevelServer = server.server

      // Provide first MCP sessionId
      const extra1 = { sessionId: mcpSessionId1 }
      const sessionId1 = getSessionId(lowLevelServer, extra1)

      const expectedSessionId1 = deriveSessionIdFromMCPSession(mcpSessionId1)
      expect(sessionId1).toBe(expectedSessionId1)

      // Change to second MCP sessionId
      const extra2 = { sessionId: mcpSessionId2 }
      const sessionId2 = getSessionId(lowLevelServer, extra2)

      const expectedSessionId2 = deriveSessionIdFromMCPSession(mcpSessionId2)
      expect(sessionId2).toBe(expectedSessionId2)
      expect(sessionId2).not.toBe(sessionId1)

      // Verify tracking data is updated
      const data = getServerTrackingData(lowLevelServer)
      expect(data?.sessionSource).toBe('mcp')

      await eventCapture.stop()
    })
  })

  describe('Session Timeout Behavior', () => {
    it('should NOT apply timeout to MCP-derived sessions', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()
      const mcpSessionId = 'mcp-session-persistent'

      instrument(server, fakePostHog())

      const lowLevelServer = server.server

      // Get MCP-derived session ID
      const extra = { sessionId: mcpSessionId }
      const sessionId1 = getSessionId(lowLevelServer, extra)

      // Manually set lastActivity to simulate timeout (31 minutes ago)
      const data = getServerTrackingData(lowLevelServer)
      if (data) {
        data.lastActivity = new Date(Date.now() - 31 * 60 * 1000)
      }

      // Get session ID again with same MCP sessionId
      const sessionId2 = getSessionId(lowLevelServer, extra)

      // Should still be the same (no timeout for MCP sessions)
      expect(sessionId2).toBe(sessionId1)

      await eventCapture.stop()
    })

    it('should apply timeout to PostHog MCP analytics-generated sessions', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      instrument(server, fakePostHog())

      const lowLevelServer = server.server

      // Get PostHog MCP analytics-generated session ID
      const sessionId1 = getSessionId(lowLevelServer)

      // Manually set lastActivity to simulate timeout (31 minutes ago)
      const data = getServerTrackingData(lowLevelServer)
      if (data) {
        data.lastActivity = new Date(Date.now() - 31 * 60 * 1000)
      }

      // Get session ID again without MCP sessionId
      const sessionId2 = getSessionId(lowLevelServer)

      // Should be different (timeout occurred)
      expect(sessionId2).not.toBe(sessionId1)
      expect(sessionId2).toMatch(SESSION_ID_PATTERN)

      await eventCapture.stop()
    })
  })

  describe('Self-encoded session token resolution', () => {
    const tokenPayload = { sessionId: 'ses_0199f41e7a2e', clientName: 'TokenClient', clientVersion: '9.9.9' }

    it('recovers the session id and client info from a token in the request headers (stateless replay)', () => {
      instrument(server, fakePostHog())
      const lowLevelServer = server.server

      const token = encodeSessionId(tokenPayload)
      const extra = { requestInfo: { headers: { [MCP_SESSION_HEADER]: token } } }

      const sessionId = getSessionId(lowLevelServer, extra)

      expect(sessionId).toBe(tokenPayload.sessionId)
      const data = getServerTrackingData(lowLevelServer)
      expect(data?.sessionSource).toBe('token')
      expect(data?.sessionInfo.clientName).toBe('TokenClient')
      expect(data?.sessionInfo.clientVersion).toBe('9.9.9')
    })

    it('treats a token in extra.sessionId as a plain transport id (tokens only count from the header)', () => {
      instrument(server, fakePostHog())
      const lowLevelServer = server.server

      const token = encodeSessionId(tokenPayload)
      const sessionId = getSessionId(lowLevelServer, { sessionId: token })

      expect(sessionId).toBe(deriveSessionIdFromMCPSession(token))
      expect(getServerTrackingData(lowLevelServer)?.sessionSource).toBe('mcp')
    })

    it('leaves non-token session ids on the hash path', () => {
      instrument(server, fakePostHog())
      const lowLevelServer = server.server

      const sessionId = getSessionId(lowLevelServer, { sessionId: 'plain-mcp-session' })

      expect(sessionId).toBe(deriveSessionIdFromMCPSession('plain-mcp-session'))
      expect(getServerTrackingData(lowLevelServer)?.sessionSource).toBe('mcp')
    })

    it('ignores a non-token header when the transport supplies no sessionId', () => {
      instrument(server, fakePostHog())
      const lowLevelServer = server.server

      const extra = { requestInfo: { headers: { [MCP_SESSION_HEADER]: 'not-a-token-uuid' } } }
      const sessionId = getSessionId(lowLevelServer, extra)

      expect(sessionId).toMatch(SESSION_ID_PATTERN)
      expect(getServerTrackingData(lowLevelServer)?.sessionSource).toBe('generated')
    })

    it('keeps the token-derived session id when a later request arrives bare', () => {
      instrument(server, fakePostHog())
      const lowLevelServer = server.server

      const token = encodeSessionId(tokenPayload)
      const first = getSessionId(lowLevelServer, {
        requestInfo: { headers: { [MCP_SESSION_HEADER]: token } },
      })
      const second = getSessionId(lowLevelServer)

      expect(second).toBe(first)
      expect(getServerTrackingData(lowLevelServer)?.sessionSource).toBe('token')
    })

    it('does NOT apply the inactivity rollover to token-derived sessions', () => {
      instrument(server, fakePostHog())
      const lowLevelServer = server.server

      const token = encodeSessionId(tokenPayload)
      const extra = { requestInfo: { headers: { [MCP_SESSION_HEADER]: token } } }
      const first = getSessionId(lowLevelServer, extra)

      const data = getServerTrackingData(lowLevelServer)
      if (data) {
        data.lastActivity = new Date(Date.now() - 31 * 60 * 1000)
      }

      expect(getSessionId(lowLevelServer, extra)).toBe(first)
      expect(getSessionId(lowLevelServer)).toBe(first)
    })
  })

  describe('Event Publishing with Session IDs', () => {
    it('should publish events with MCP-derived session IDs', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()
      const mcpSessionId = 'mcp-session-for-events'
      expect(deriveSessionIdFromMCPSession(mcpSessionId)).toMatch(SESSION_ID_PATTERN)

      instrument(server, fakePostHog())

      // TODO: This test would require mocking the transport to inject sessionId into extra
      // For now, we'll verify the logic with direct function calls above
      // In a real MCP environment, the sessionId would come from the transport layer

      await eventCapture.stop()
    })
  })
})
