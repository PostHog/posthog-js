import { instrument } from '../index'
import { getSessionId } from '../extensions/session'
import { stampClientIdentity } from '../extensions/client-identity'
import { deriveSessionIdFromConversation } from '../extensions/session'
import type { HighLevelMCPServerLike, McpEvent, MCPRequestLike, MCPServerLike } from '../types'
import { fakePostHog } from './test-utils'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'

/**
 * Host-supplied `sessionId` and `clientInfo` callbacks, for stateless per-request
 * servers where the SDK's own token/handshake cannot carry either.
 */
describe('options.sessionId and options.clientInfo', () => {
  let server: HighLevelMCPServerLike
  let cleanup: () => Promise<void>
  const request: MCPRequestLike = { method: 'tools/call', params: { name: 'add_todo', arguments: {} } }

  beforeEach(async () => {
    resetTodos()
    const setup = await setupTestServerAndClient()
    server = setup.server
    cleanup = setup.cleanup
  })

  afterEach(async () => {
    await cleanup()
  })

  const lowLevel = () => server.server as MCPServerLike

  it('derives the session from the host value, deterministically', () => {
    instrument(server, fakePostHog(), { sessionId: () => 'host-session-1' })
    const a = getSessionId(lowLevel(), undefined, undefined, request)
    expect(a).toBe(deriveSessionIdFromConversation('host-session-1'))
    expect(a).toMatch(/^ses_/)
    expect(getSessionId(lowLevel(), undefined, undefined, request)).toBe(a)
  })

  it('passes the request and extra to the callback', () => {
    const sessionId = vi.fn(() => 'x')
    instrument(server, fakePostHog(), { sessionId })
    const extra = { requestInfo: { headers: { 'x-session': 'abc' } } } as never
    getSessionId(lowLevel(), extra, undefined, request)
    expect(sessionId).toHaveBeenCalledWith(request, extra)
  })

  it('wins over a conversation handle', () => {
    instrument(server, fakePostHog(), { sessionId: () => 'host-session-1' })
    expect(getSessionId(lowLevel(), undefined, 'conversation-abc', request)).toBe(
      deriveSessionIdFromConversation('host-session-1')
    )
  })

  it.each([null, undefined, '', 5 as never])('falls back to the SDK resolution when it returns %s', (value) => {
    instrument(server, fakePostHog(), { sessionId: () => value })
    const fallback = getSessionId(lowLevel(), undefined, undefined, undefined)
    expect(getSessionId(lowLevel(), undefined, undefined, request)).toBe(fallback)
  })

  it('ignores a throwing callback', () => {
    instrument(server, fakePostHog(), {
      sessionId: () => {
        throw new Error('boom')
      },
    })
    expect(() => getSessionId(lowLevel(), undefined, undefined, request)).not.toThrow()
  })

  it('does not write the host session into shared instance state', () => {
    instrument(server, fakePostHog(), { sessionId: () => 'host-session-1' })
    const before = getSessionId(lowLevel(), undefined, undefined, undefined)
    getSessionId(lowLevel(), undefined, undefined, request)
    expect(getSessionId(lowLevel(), undefined, undefined, undefined)).toBe(before)
  })

  it('stamps the host client name and version on the event, over what the SDK resolved', () => {
    instrument(server, fakePostHog(), { clientInfo: () => ({ name: 'host-client', version: '3.2.1' }) })
    const withMeta: MCPRequestLike = {
      ...request,
      params: { ...request.params, _meta: { 'io.modelcontextprotocol/clientInfo': { name: 'meta', version: '1' } } },
    }
    const event: McpEvent = {}
    stampClientIdentity(event, withMeta, undefined, lowLevel())
    expect(event.clientName).toBe('host-client')
    expect(event.clientVersion).toBe('3.2.1')
  })

  it('stamps a host client even when the SDK resolved nothing', () => {
    instrument(server, fakePostHog(), { clientInfo: () => ({ name: 'host-client' }) })
    const event: McpEvent = {}
    stampClientIdentity(event, request, undefined, lowLevel())
    expect(event.clientName).toBe('host-client')
    expect(event.clientVersion).toBeUndefined()
  })

  it('leaves the event alone when the callback returns nothing or throws', () => {
    for (const clientInfo of [
      () => null,
      () => undefined,
      () => {
        throw new Error('boom')
      },
    ]) {
      const s = lowLevel()
      instrument(server, fakePostHog(), { clientInfo })
      const event: McpEvent = { clientName: 'existing' }
      expect(() => stampClientIdentity(event, request, undefined, s)).not.toThrow()
      expect(event.clientName).toBe('existing')
    }
  })
})
