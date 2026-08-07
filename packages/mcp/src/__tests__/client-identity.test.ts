import {
  META_CLIENT_INFO_KEY,
  META_PROTOCOL_VERSION_KEY,
  readMetaClientInfo,
  resolveClientIdentity,
  stampClientIdentity,
} from '../extensions/client-identity'
import type { CompatibleRequestHandlerExtra, McpEvent, MCPRequestLike, MCPServerLike } from '../types'

function requestWithMeta(meta: Record<string, unknown> | undefined): MCPRequestLike {
  return { method: 'tools/call', params: { name: 'echo', arguments: {}, _meta: meta } }
}

/**
 * MCP SDK v2 lifts the reserved `io.modelcontextprotocol/*` keys out of `_meta`
 * while parsing, so a modern-era request reaches the handler with an empty
 * `params._meta` and the values on the context instead.
 */
function ctxWithEnvelope(envelope: Record<string, unknown>): CompatibleRequestHandlerExtra {
  return { mcpReq: { envelope } } as unknown as CompatibleRequestHandlerExtra
}

function serverWith(accessors: Partial<Record<'getClientVersion' | 'getNegotiatedProtocolVersion', () => unknown>>) {
  return accessors as unknown as MCPServerLike
}

describe('client-identity', () => {
  describe('readMetaClientInfo', () => {
    it('reads clientInfo name/version and protocolVersion from _meta', () => {
      const info = readMetaClientInfo(
        requestWithMeta({
          [META_CLIENT_INFO_KEY]: { name: 'codex', version: '1.2.3' },
          [META_PROTOCOL_VERSION_KEY]: '2026-07-28',
        })
      )
      expect(info).toEqual({ clientName: 'codex', clientVersion: '1.2.3', protocolVersion: '2026-07-28' })
    })

    it('returns undefined when _meta is absent', () => {
      expect(readMetaClientInfo(requestWithMeta(undefined))).toBeUndefined()
      expect(readMetaClientInfo({ method: 'tools/call', params: { name: 'echo' } })).toBeUndefined()
      expect(readMetaClientInfo({ method: 'tools/call' })).toBeUndefined()
    })

    it('returns undefined when _meta has no recognized keys', () => {
      expect(readMetaClientInfo(requestWithMeta({ 'com.other/thing': 1 }))).toBeUndefined()
    })

    it('ignores empty / non-string fields', () => {
      const info = readMetaClientInfo(
        requestWithMeta({
          [META_CLIENT_INFO_KEY]: { name: '', version: 42 },
          [META_PROTOCOL_VERSION_KEY]: '',
        })
      )
      expect(info).toBeUndefined()
    })

    it('reads a partial (protocolVersion only)', () => {
      expect(readMetaClientInfo(requestWithMeta({ [META_PROTOCOL_VERSION_KEY]: '2026-07-28' }))).toEqual({
        protocolVersion: '2026-07-28',
      })
    })
  })

  describe('stampClientIdentity', () => {
    it('stamps present fields onto the event', () => {
      const event: McpEvent = {}
      stampClientIdentity(
        event,
        requestWithMeta({
          [META_CLIENT_INFO_KEY]: { name: 'codex', version: '1.2.3' },
          [META_PROTOCOL_VERSION_KEY]: '2026-07-28',
        })
      )
      expect(event.clientName).toBe('codex')
      expect(event.clientVersion).toBe('1.2.3')
      expect(event.protocolVersion).toBe('2026-07-28')
    })

    it('leaves the event untouched when _meta is absent', () => {
      const event: McpEvent = { clientName: 'existing', protocolVersion: '2025-11-25' }
      stampClientIdentity(event, requestWithMeta(undefined))
      expect(event.clientName).toBe('existing')
      expect(event.protocolVersion).toBe('2025-11-25')
    })

    it('only overwrites the fields the request actually carries', () => {
      const event: McpEvent = { clientName: 'existing', clientVersion: '0.0.1' }
      stampClientIdentity(event, requestWithMeta({ [META_PROTOCOL_VERSION_KEY]: '2026-07-28' }))
      expect(event.clientName).toBe('existing')
      expect(event.clientVersion).toBe('0.0.1')
      expect(event.protocolVersion).toBe('2026-07-28')
    })

    it('does not cross-attribute across two concurrent requests sharing a server', () => {
      // Each request stamps its OWN event, so one can't clobber the other's
      // identity — the property the shared-state approach lacked.
      const eventA: McpEvent = {}
      const eventB: McpEvent = {}
      stampClientIdentity(eventA, requestWithMeta({ [META_CLIENT_INFO_KEY]: { name: 'codex', version: '1.0.0' } }))
      stampClientIdentity(eventB, requestWithMeta({ [META_CLIENT_INFO_KEY]: { name: 'claude', version: '2.0.0' } }))
      expect(eventA.clientName).toBe('codex')
      expect(eventB.clientName).toBe('claude')
    })
  })

  /**
   * The chain, not a branch: the same v2 server serves 2025-era requests
   * routinely, so era is a per-request property and every source has to be tried
   * in order rather than selected up front.
   */
  describe('resolveClientIdentity', () => {
    const envelopeIdentity = {
      [META_CLIENT_INFO_KEY]: { name: 'envelope-client', version: '2.0.0' },
      [META_PROTOCOL_VERSION_KEY]: '2026-07-28',
    }

    it('reads the v2 envelope, where a modern-era request actually carries identity', () => {
      const identity = resolveClientIdentity({
        request: requestWithMeta(undefined),
        extra: ctxWithEnvelope(envelopeIdentity),
      })
      expect(identity).toEqual({
        clientName: 'envelope-client',
        clientVersion: '2.0.0',
        protocolVersion: '2026-07-28',
      })
    })

    it('prefers the envelope over _meta when both are present', () => {
      const identity = resolveClientIdentity({
        request: requestWithMeta({ [META_CLIENT_INFO_KEY]: { name: 'meta-client', version: '1.0.0' } }),
        extra: ctxWithEnvelope(envelopeIdentity),
      })
      expect(identity?.clientName).toBe('envelope-client')
    })

    it('falls back to _meta when there is no envelope — a v1 server never has one', () => {
      const identity = resolveClientIdentity({
        request: requestWithMeta({ [META_CLIENT_INFO_KEY]: { name: 'meta-client', version: '1.0.0' } }),
        extra: { requestInfo: { headers: {} } } as CompatibleRequestHandlerExtra,
      })
      expect(identity?.clientName).toBe('meta-client')
    })

    it('falls back to the server accessors when the request carries nothing', () => {
      const identity = resolveClientIdentity({
        request: requestWithMeta(undefined),
        server: serverWith({
          getClientVersion: () => ({ name: 'handshake-client', version: '1.2.3' }),
          getNegotiatedProtocolVersion: () => '2026-07-28',
        }),
      })
      expect(identity).toEqual({
        clientName: 'handshake-client',
        clientVersion: '1.2.3',
        protocolVersion: '2026-07-28',
      })
    })

    it('fills fields independently, so a partial source does not shadow a later one', () => {
      // The envelope declares the era; the name is only known from the handshake.
      const identity = resolveClientIdentity({
        request: requestWithMeta(undefined),
        extra: ctxWithEnvelope({ [META_PROTOCOL_VERSION_KEY]: '2026-07-28' }),
        server: serverWith({ getClientVersion: () => ({ name: 'handshake-client', version: '1.2.3' }) }),
      })
      expect(identity).toEqual({
        clientName: 'handshake-client',
        clientVersion: '1.2.3',
        protocolVersion: '2026-07-28',
      })
    })

    it('ignores a server without the v2-only protocol accessor instead of branching on SDK version', () => {
      const identity = resolveClientIdentity({
        request: requestWithMeta(undefined),
        server: serverWith({ getClientVersion: () => ({ name: 'v1-client', version: '1.0.0' }) }),
      })
      expect(identity).toEqual({ clientName: 'v1-client', clientVersion: '1.0.0' })
    })

    it('never throws when an accessor does', () => {
      const identity = resolveClientIdentity({
        request: requestWithMeta(undefined),
        server: serverWith({
          getClientVersion: () => {
            throw new Error('not connected')
          },
        }),
      })
      expect(identity).toBeUndefined()
    })

    it('returns undefined when no source answers', () => {
      expect(resolveClientIdentity({ request: requestWithMeta(undefined) })).toBeUndefined()
    })
  })

  describe('stampClientIdentity through the chain', () => {
    it('stamps identity a v2 modern-era request only carries in the envelope', () => {
      const event: McpEvent = {}
      stampClientIdentity(event, requestWithMeta(undefined), ctxWithEnvelope(envelopeOnly), undefined)
      expect(event.clientName).toBe('envelope-client')
      expect(event.protocolVersion).toBe('2026-07-28')
    })

    it('stamps the negotiated protocol version when the request carries none', () => {
      const event: McpEvent = {}
      stampClientIdentity(
        event,
        requestWithMeta(undefined),
        undefined,
        serverWith({
          getNegotiatedProtocolVersion: () => '2026-07-28',
        })
      )
      expect(event.protocolVersion).toBe('2026-07-28')
    })
  })
})

const envelopeOnly = {
  [META_CLIENT_INFO_KEY]: { name: 'envelope-client', version: '2.0.0' },
  [META_PROTOCOL_VERSION_KEY]: '2026-07-28',
}
