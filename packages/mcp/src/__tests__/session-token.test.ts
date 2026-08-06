import {
  MCP_SESSION_HEADER,
  decodeSessionId,
  encodeSessionId,
  readMcpSessionHeader,
  writeSessionIdToTransport,
  type SessionTokenPayload,
} from '../extensions/session-token'

/** Builds a raw wire value (base64url JSON) — the only place short keys exist. */
const wire = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')

describe('session token codec', () => {
  describe('encodeSessionId / decodeSessionId round trip', () => {
    it('round-trips a session-id-only payload', () => {
      const token = encodeSessionId({ sessionId: 'ses_0199aabb' })
      expect(decodeSessionId(token)).toEqual({ sessionId: 'ses_0199aabb' })
    })

    it('round-trips session id + client name/version', () => {
      const payload: SessionTokenPayload = { sessionId: 'ses_0199aabb', clientName: 'Claude', clientVersion: '1.2.3' }
      expect(decodeSessionId(encodeSessionId(payload))).toEqual(payload)
    })

    it('round-trips the protocol version', () => {
      const payload: SessionTokenPayload = {
        sessionId: 'ses_0199aabb',
        clientName: 'Claude',
        clientVersion: '1.2.3',
        protocolVersion: '2025-06-18',
      }
      expect(decodeSessionId(encodeSessionId(payload))).toEqual(payload)
    })

    it('round-trips unicode client names', () => {
      const payload: SessionTokenPayload = {
        sessionId: 'ses_0199aabb',
        clientName: 'Клиент 😀 客户端',
        clientVersion: '1.0',
      }
      const token = encodeSessionId(payload)
      // The header value itself must stay visible-ASCII per the MCP spec.
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(decodeSessionId(token)).toEqual(payload)
    })

    it('clamps oversized client fields at encode time', () => {
      const token = encodeSessionId({ sessionId: 'ses_x', clientName: 'a'.repeat(500), clientVersion: 'b'.repeat(500) })
      const decoded = decodeSessionId(token)
      expect(decoded?.clientName).toHaveLength(200)
      expect(decoded?.clientVersion).toHaveLength(200)
    })

    it('omits missing client fields', () => {
      const token = encodeSessionId({ sessionId: 'ses_x', clientName: undefined, clientVersion: undefined })
      expect(decodeSessionId(token)).toEqual({ sessionId: 'ses_x' })
    })

    it('throws on a missing session id (public API misuse)', () => {
      expect(() => encodeSessionId({ sessionId: '' })).toThrow()
      expect(() => encodeSessionId(undefined as unknown as SessionTokenPayload)).toThrow()
    })

    it('encodes and decodes identically without Buffer (edge runtimes)', () => {
      const payload: SessionTokenPayload = { sessionId: 'ses_0199aabb', clientName: 'Клиент 😀', clientVersion: '1.0' }
      const withBuffer = encodeSessionId(payload)

      const g = globalThis as { Buffer?: typeof Buffer }
      const originalBuffer = g.Buffer
      delete g.Buffer
      try {
        expect(typeof Buffer).toBe('undefined')
        expect(encodeSessionId(payload)).toBe(withBuffer)
        expect(decodeSessionId(withBuffer)).toEqual(payload)
      } finally {
        g.Buffer = originalBuffer
      }
    })
  })

  describe('decodeSessionId strictness', () => {
    it.each([
      ['a plain UUID', '550e8400-e29b-41d4-a716-446655440000'],
      ['an SDK-generated session id', 'ses_0199aabbccdd'],
      ['a JWT-shaped value', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig'],
      ['a value with invalid characters', 'not a token!'],
      ['base64url of non-JSON', Buffer.from('not json at all', 'utf8').toString('base64url')],
      ['an empty string', ''],
    ])('returns null for %s', (_label, value) => {
      expect(decodeSessionId(value)).toBeNull()
    })

    it('returns null for non-string inputs', () => {
      expect(decodeSessionId(undefined)).toBeNull()
      expect(decodeSessionId(null)).toBeNull()
      expect(decodeSessionId(42)).toBeNull()
      expect(decodeSessionId(['a'])).toBeNull()
    })

    it('returns null for JSON that is not a token object', () => {
      expect(decodeSessionId(wire(['ses_x']))).toBeNull()
      expect(decodeSessionId(wire('ses_x'))).toBeNull()
      expect(decodeSessionId(wire(null))).toBeNull()
      expect(decodeSessionId(wire({ cn: 'no sid' }))).toBeNull()
      expect(decodeSessionId(wire({ sid: 42 }))).toBeNull()
      expect(decodeSessionId(wire({ sid: '' }))).toBeNull()
      expect(decodeSessionId(wire({ sid: 'x'.repeat(200) }))).toBeNull()
    })

    it('returns null for oversized header values', () => {
      const huge = wire({ sid: 'ses_x', cn: 'y'.repeat(8000) })
      expect(huge.length).toBeGreaterThan(4096)
      expect(decodeSessionId(huge)).toBeNull()
    })

    it('keeps the session id but drops malformed client fields', () => {
      expect(decodeSessionId(wire({ sid: 'ses_x', cn: 42, cv: {} }))).toEqual({ sessionId: 'ses_x' })
    })
  })

  describe('readMcpSessionHeader', () => {
    it('reads the lowercased header', () => {
      expect(readMcpSessionHeader({ [MCP_SESSION_HEADER]: 'abc' })).toBe('abc')
    })

    it('falls back to a case-insensitive match', () => {
      expect(readMcpSessionHeader({ 'Mcp-Session-Id': 'abc' })).toBe('abc')
    })

    it('takes the first element of a multi-value header', () => {
      expect(readMcpSessionHeader({ [MCP_SESSION_HEADER]: ['abc', 'def'] })).toBe('abc')
    })

    it('returns undefined for missing/empty/non-object inputs', () => {
      expect(readMcpSessionHeader({})).toBeUndefined()
      expect(readMcpSessionHeader({ [MCP_SESSION_HEADER]: '' })).toBeUndefined()
      expect(readMcpSessionHeader({ [MCP_SESSION_HEADER]: '   ' })).toBeUndefined()
      expect(readMcpSessionHeader({ [MCP_SESSION_HEADER]: 42 })).toBeUndefined()
      expect(readMcpSessionHeader(undefined)).toBeUndefined()
      expect(readMcpSessionHeader('headers')).toBeUndefined()
    })
  })

  describe('writeSessionIdToTransport', () => {
    it('writes to a plain mutable sessionId (web-standard transport shape)', () => {
      const transport: { sessionId?: string } = {}
      expect(writeSessionIdToTransport(transport, 'tok')).toBe(true)
      expect(transport.sessionId).toBe('tok')
    })

    it('writes through _webStandardTransport when sessionId is getter-only (Node wrapper shape)', () => {
      const inner: { sessionId?: string } = {}
      const wrapper: { _webStandardTransport: typeof inner; sessionId?: string } = { _webStandardTransport: inner }
      Object.defineProperty(wrapper, 'sessionId', {
        get: () => inner.sessionId,
        configurable: true,
      })

      expect(writeSessionIdToTransport(wrapper, 'tok')).toBe(true)
      expect(inner.sessionId).toBe('tok')
      expect(wrapper.sessionId).toBe('tok')
    })

    it('returns false without throwing when nothing is writable', () => {
      const gettersOnly = {}
      Object.defineProperty(gettersOnly, 'sessionId', { get: () => undefined, configurable: true })
      expect(writeSessionIdToTransport(gettersOnly, 'tok')).toBe(false)

      expect(writeSessionIdToTransport(Object.freeze({}), 'tok')).toBe(false)
      expect(writeSessionIdToTransport(undefined, 'tok')).toBe(false)
      expect(writeSessionIdToTransport('transport', 'tok')).toBe(false)
    })
  })
})
