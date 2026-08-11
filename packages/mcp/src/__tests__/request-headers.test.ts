import { getRequestHeaders } from '../extensions/request-headers'

/**
 * A stand-in for a WHATWG `Headers` from another realm: it quacks the same way
 * but fails `instanceof Headers`, which is exactly the workerd case.
 */
class ForeignHeaders {
  private readonly entriesList: [string, string][]

  constructor(entries: [string, string][]) {
    this.entriesList = entries
  }

  get(name: string): string | null {
    const match = this.entriesList.find(([key]) => key.toLowerCase() === name.toLowerCase())
    return match ? match[1] : null
  }

  entries(): Iterable<[string, string]> {
    return this.entriesList[Symbol.iterator]()
  }
}

describe('getRequestHeaders', () => {
  describe('v1 shape — extra.requestInfo.headers', () => {
    it('reads a plain header object', () => {
      const extra = { requestInfo: { headers: { authorization: 'Bearer v1', 'mcp-session-id': 'abc' } } }
      expect(getRequestHeaders(extra)).toEqual({ authorization: 'Bearer v1', 'mcp-session-id': 'abc' })
    })

    it('lowercases keys so a host reads them the documented way', () => {
      const extra = { requestInfo: { headers: { Authorization: 'Bearer v1', 'X-Tenant': 'acme' } } }
      expect(getRequestHeaders(extra)).toEqual({ authorization: 'Bearer v1', 'x-tenant': 'acme' })
    })

    it('keeps repeated headers as an array', () => {
      const extra = { requestInfo: { headers: { 'set-cookie': ['a=1', 'b=2'] } } }
      expect(getRequestHeaders(extra)?.['set-cookie']).toEqual(['a=1', 'b=2'])
    })

    it('drops undefined values, which Node header bags carry', () => {
      const extra = { requestInfo: { headers: { authorization: 'Bearer v1', 'x-missing': undefined } } }
      expect(getRequestHeaders(extra)).toEqual({ authorization: 'Bearer v1' })
    })
  })

  describe('v2 shape — extra.http.req.headers', () => {
    it('reads a WHATWG Headers instance', () => {
      const extra = {
        http: { req: new Request('https://example.com/mcp', { headers: { authorization: 'Bearer v2' } }) },
      }
      expect(getRequestHeaders(extra)).toEqual(expect.objectContaining({ authorization: 'Bearer v2' }))
    })

    it('duck-types Headers rather than using instanceof, for cross-realm objects', () => {
      const extra = {
        http: {
          req: {
            headers: new ForeignHeaders([
              ['Authorization', 'Bearer v2'],
              ['x-tenant', 'acme'],
            ]),
          },
        },
      }
      expect(getRequestHeaders(extra)).toEqual({ authorization: 'Bearer v2', 'x-tenant': 'acme' })
    })

    it('accepts a plain object where the SDK would hand Headers, since a framework may substitute one', () => {
      const extra = { http: { req: { headers: { Authorization: 'Bearer v2' } } } }
      expect(getRequestHeaders(extra)).toEqual({ authorization: 'Bearer v2' })
    })

    it('prefers the v2 location when both are present', () => {
      const extra = {
        http: { req: { headers: { authorization: 'from-v2' } } },
        requestInfo: { headers: { authorization: 'from-v1' } },
      }
      expect(getRequestHeaders(extra)?.['authorization']).toBe('from-v2')
    })
  })

  describe('no headers to read', () => {
    it.each([
      ['undefined extra', undefined],
      ['null extra', null],
      ['a non-object extra', 'nope'],
      ['stdio/in-memory extra with neither field', { sessionId: 'abc' }],
      ['a v2 context with no HTTP request', { http: {} }],
      ['a requestInfo with no headers', { requestInfo: {} }],
      ['a non-object headers value', { requestInfo: { headers: 'oops' } }],
    ])('returns undefined for %s', (_label, extra) => {
      expect(getRequestHeaders(extra)).toBeUndefined()
    })

    it('never throws when reading headers blows up', () => {
      const exploding = {
        get: () => null,
        entries: () => {
          throw new Error('boom')
        },
      }
      expect(getRequestHeaders({ http: { req: { headers: exploding } } })).toBeUndefined()
    })
  })
})
