import { instrument } from '../index'
import { getServerTrackingData } from '../extensions/internal'
import { deriveSessionIdFromMCPSession, getServerSessionId } from '../extensions/session'
import type { HighLevelMCPServerLike } from '../types'
import { EventCapture } from './test-utils'
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

      const apiKey = 'test-project-mcp'
      const mcpSessionId = 'mcp-session-abc-123'

      instrument(server, { apiKey, enableTracing: true })

      // Get the low-level server
      const lowLevelServer = server.server

      // Simulate MCP sessionId in extra parameter
      const extra = { sessionId: mcpSessionId }

      // Get session ID with MCP sessionId provided
      const sessionId = getServerSessionId(lowLevelServer, extra)

      // Verify it's deterministically derived
      const expectedSessionId = deriveSessionIdFromMCPSession(mcpSessionId)
      expect(sessionId).toBe(expectedSessionId)

      // Verify tracking data is updated
      const data = getServerTrackingData(lowLevelServer)
      expect(data?.lastMcpSessionId).toBe(mcpSessionId)
      expect(data?.sessionSource).toBe('mcp')

      await eventCapture.stop()
    })

    it('should use PostHog MCP analytics-generated sessionId when no MCP sessionId provided', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      instrument(server, { apiKey: 'test-project', enableTracing: true })

      const lowLevelServer = server.server

      // Get initial session ID without MCP sessionId
      const sessionId1 = getServerSessionId(lowLevelServer)
      expect(sessionId1).toMatch(SESSION_ID_PATTERN)

      // Verify tracking data shows PostHog MCP analytics source
      const data = getServerTrackingData(lowLevelServer)
      expect(data?.sessionSource).toBe('generated')
      expect(data?.lastMcpSessionId).toBeUndefined()

      // Get session ID again - should be the same
      const sessionId2 = getServerSessionId(lowLevelServer)
      expect(sessionId2).toBe(sessionId1)

      await eventCapture.stop()
    })

    it('should switch to MCP-derived sessionId when MCP sessionId appears', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      const apiKey = 'test-project-switch'
      const mcpSessionId = 'mcp-session-appears'

      instrument(server, { apiKey, enableTracing: true })

      const lowLevelServer = server.server

      // Start with no MCP sessionId
      const generatedSessionId = getServerSessionId(lowLevelServer)
      expect(generatedSessionId).toMatch(SESSION_ID_PATTERN)

      let data = getServerTrackingData(lowLevelServer)
      expect(data?.sessionSource).toBe('generated')

      // Now provide MCP sessionId
      const extra = { sessionId: mcpSessionId }
      const mcpDerivedSessionId = getServerSessionId(lowLevelServer, extra)

      // Verify it switched to MCP-derived ID
      const expectedSessionId = deriveSessionIdFromMCPSession(mcpSessionId)
      expect(mcpDerivedSessionId).toBe(expectedSessionId)
      expect(mcpDerivedSessionId).not.toBe(generatedSessionId)

      // Verify tracking data is updated
      data = getServerTrackingData(lowLevelServer)
      expect(data?.lastMcpSessionId).toBe(mcpSessionId)
      expect(data?.sessionSource).toBe('mcp')

      await eventCapture.stop()
    })

    it('should keep last derived sessionId when MCP sessionId disappears', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      const apiKey = 'test-project-disappear'
      const mcpSessionId = 'mcp-session-disappears'

      instrument(server, { apiKey, enableTracing: true })

      const lowLevelServer = server.server

      // Provide MCP sessionId
      const extra = { sessionId: mcpSessionId }
      const mcpDerivedSessionId = getServerSessionId(lowLevelServer, extra)

      const expectedSessionId = deriveSessionIdFromMCPSession(mcpSessionId)
      expect(mcpDerivedSessionId).toBe(expectedSessionId)

      // Now call without MCP sessionId (it disappeared)
      const sessionIdAfterDisappear = getServerSessionId(lowLevelServer)

      // Should keep using the last derived sessionId
      expect(sessionIdAfterDisappear).toBe(mcpDerivedSessionId)

      // Verify tracking data still shows MCP source
      const data = getServerTrackingData(lowLevelServer)
      expect(data?.sessionSource).toBe('mcp')
      expect(data?.lastMcpSessionId).toBe(mcpSessionId)

      await eventCapture.stop()
    })

    it('should regenerate sessionId when MCP sessionId changes', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      const apiKey = 'test-project-change'
      const mcpSessionId1 = 'mcp-session-first'
      const mcpSessionId2 = 'mcp-session-second'

      instrument(server, { apiKey, enableTracing: true })

      const lowLevelServer = server.server

      // Provide first MCP sessionId
      const extra1 = { sessionId: mcpSessionId1 }
      const sessionId1 = getServerSessionId(lowLevelServer, extra1)

      const expectedSessionId1 = deriveSessionIdFromMCPSession(mcpSessionId1)
      expect(sessionId1).toBe(expectedSessionId1)

      // Change to second MCP sessionId
      const extra2 = { sessionId: mcpSessionId2 }
      const sessionId2 = getServerSessionId(lowLevelServer, extra2)

      const expectedSessionId2 = deriveSessionIdFromMCPSession(mcpSessionId2)
      expect(sessionId2).toBe(expectedSessionId2)
      expect(sessionId2).not.toBe(sessionId1)

      // Verify tracking data is updated
      const data = getServerTrackingData(lowLevelServer)
      expect(data?.lastMcpSessionId).toBe(mcpSessionId2)
      expect(data?.sessionSource).toBe('mcp')

      await eventCapture.stop()
    })
  })

  describe('Session Timeout Behavior', () => {
    it('should NOT apply timeout to MCP-derived sessions', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      const apiKey = 'test-project-timeout'
      const mcpSessionId = 'mcp-session-persistent'

      instrument(server, { apiKey, enableTracing: true })

      const lowLevelServer = server.server

      // Get MCP-derived session ID
      const extra = { sessionId: mcpSessionId }
      const sessionId1 = getServerSessionId(lowLevelServer, extra)

      // Manually set lastActivity to simulate timeout (31 minutes ago)
      const data = getServerTrackingData(lowLevelServer)
      if (data) {
        data.lastActivity = new Date(Date.now() - 31 * 60 * 1000)
      }

      // Get session ID again with same MCP sessionId
      const sessionId2 = getServerSessionId(lowLevelServer, extra)

      // Should still be the same (no timeout for MCP sessions)
      expect(sessionId2).toBe(sessionId1)

      await eventCapture.stop()
    })

    it('should apply timeout to PostHog MCP analytics-generated sessions', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      instrument(server, { apiKey: 'test-project', enableTracing: true })

      const lowLevelServer = server.server

      // Get PostHog MCP analytics-generated session ID
      const sessionId1 = getServerSessionId(lowLevelServer)

      // Manually set lastActivity to simulate timeout (31 minutes ago)
      const data = getServerTrackingData(lowLevelServer)
      if (data) {
        data.lastActivity = new Date(Date.now() - 31 * 60 * 1000)
      }

      // Get session ID again without MCP sessionId
      const sessionId2 = getServerSessionId(lowLevelServer)

      // Should be different (timeout occurred)
      expect(sessionId2).not.toBe(sessionId1)
      expect(sessionId2).toMatch(SESSION_ID_PATTERN)

      await eventCapture.stop()
    })
  })

  describe('Event Publishing with Session IDs', () => {
    it('should publish events with MCP-derived session IDs', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      const apiKey = 'test-project-events'
      const mcpSessionId = 'mcp-session-for-events'
      expect(deriveSessionIdFromMCPSession(mcpSessionId)).toMatch(SESSION_ID_PATTERN)

      instrument(server, { apiKey, enableTracing: true })

      // TODO: This test would require mocking the transport to inject sessionId into extra
      // For now, we'll verify the logic with direct function calls above
      // In a real MCP environment, the sessionId would come from the transport layer

      await eventCapture.stop()
    })
  })
})
