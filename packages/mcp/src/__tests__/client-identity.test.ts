import {
  META_CLIENT_INFO_KEY,
  META_PROTOCOL_VERSION_KEY,
  applyMetaClientInfo,
  readMetaClientInfo,
} from '../extensions/client-identity'
import type { MCPAnalyticsData, MCPRequestLike, SessionInfo } from '../types'

function requestWithMeta(meta: Record<string, unknown> | undefined): MCPRequestLike {
  return { method: 'tools/call', params: { name: 'echo', arguments: {}, _meta: meta } }
}

function dataWithSessionInfo(sessionInfo: Partial<SessionInfo> = {}): MCPAnalyticsData {
  return { sessionInfo } as unknown as MCPAnalyticsData
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

  describe('applyMetaClientInfo', () => {
    it('copies present fields onto sessionInfo', () => {
      const data = dataWithSessionInfo()
      applyMetaClientInfo(
        data,
        requestWithMeta({
          [META_CLIENT_INFO_KEY]: { name: 'codex', version: '1.2.3' },
          [META_PROTOCOL_VERSION_KEY]: '2026-07-28',
        })
      )
      expect(data.sessionInfo.clientName).toBe('codex')
      expect(data.sessionInfo.clientVersion).toBe('1.2.3')
      expect(data.sessionInfo.protocolVersion).toBe('2026-07-28')
    })

    it('leaves existing values untouched when _meta is absent', () => {
      const data = dataWithSessionInfo({ clientName: 'existing', protocolVersion: '2025-11-25' })
      applyMetaClientInfo(data, requestWithMeta(undefined))
      expect(data.sessionInfo.clientName).toBe('existing')
      expect(data.sessionInfo.protocolVersion).toBe('2025-11-25')
    })

    it('only overwrites the fields the request actually carries', () => {
      const data = dataWithSessionInfo({ clientName: 'existing', clientVersion: '0.0.1' })
      applyMetaClientInfo(data, requestWithMeta({ [META_PROTOCOL_VERSION_KEY]: '2026-07-28' }))
      expect(data.sessionInfo.clientName).toBe('existing')
      expect(data.sessionInfo.clientVersion).toBe('0.0.1')
      expect(data.sessionInfo.protocolVersion).toBe('2026-07-28')
    })
  })
})
