import {
  META_CLIENT_INFO_KEY,
  META_PROTOCOL_VERSION_KEY,
  readMetaClientInfo,
  stampMetaClientInfo,
} from '../extensions/client-identity'
import type { McpEvent, MCPRequestLike } from '../types'

function requestWithMeta(meta: Record<string, unknown> | undefined): MCPRequestLike {
  return { method: 'tools/call', params: { name: 'echo', arguments: {}, _meta: meta } }
}

describe('client-identity (_meta client info)', () => {
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

  describe('stampMetaClientInfo', () => {
    it('stamps present fields onto the event', () => {
      const event: McpEvent = {}
      stampMetaClientInfo(
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
      stampMetaClientInfo(event, requestWithMeta(undefined))
      expect(event.clientName).toBe('existing')
      expect(event.protocolVersion).toBe('2025-11-25')
    })

    it('only overwrites the fields the request actually carries', () => {
      const event: McpEvent = { clientName: 'existing', clientVersion: '0.0.1' }
      stampMetaClientInfo(event, requestWithMeta({ [META_PROTOCOL_VERSION_KEY]: '2026-07-28' }))
      expect(event.clientName).toBe('existing')
      expect(event.clientVersion).toBe('0.0.1')
      expect(event.protocolVersion).toBe('2026-07-28')
    })

    it('does not cross-attribute across two concurrent requests sharing a server', () => {
      // Each request stamps its OWN event, so one can't clobber the other's
      // identity — the property the shared-state approach lacked.
      const eventA: McpEvent = {}
      const eventB: McpEvent = {}
      stampMetaClientInfo(eventA, requestWithMeta({ [META_CLIENT_INFO_KEY]: { name: 'codex', version: '1.0.0' } }))
      stampMetaClientInfo(eventB, requestWithMeta({ [META_CLIENT_INFO_KEY]: { name: 'claude', version: '2.0.0' } }))
      expect(eventA.clientName).toBe('codex')
      expect(eventB.clientName).toBe('claude')
    })
  })
})
