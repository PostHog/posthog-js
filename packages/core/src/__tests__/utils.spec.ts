import { assert, removeTrailingSlash, stripUrlHash, currentISOTime, currentTimestamp } from '@/utils'

describe('utils', () => {
  describe('assert', () => {
    it('should throw on falsey values', () => {
      ;[false, '', null, undefined, 0, {}, []].forEach((x) => {
        expect(() => assert(x, 'error')).toThrow('error')
      })
    })
    it('should not throw on truthy value', () => {
      expect(() => assert('string', 'error')).not.toThrow('error')
    })
  })
  describe('removeTrailingSlash', () => {
    it('should removeSlashes', () => {
      expect(removeTrailingSlash('me////')).toEqual('me')
      expect(removeTrailingSlash('me/wat///')).toEqual('me/wat')
      expect(removeTrailingSlash('me/')).toEqual('me')
      expect(removeTrailingSlash('/me')).toEqual('/me')
    })
  })
  describe('stripUrlHash', () => {
    it.each([
      ['https://example.com/path#section', 'https://example.com/path'],
      ['https://example.com/path?foo=bar#section', 'https://example.com/path?foo=bar'],
      ['https://example.com/#/dashboard/123', 'https://example.com/'],
      ['https://example.com/path#section#nested', 'https://example.com/path'],
      ['https://example.com/path#', 'https://example.com/path'],
      ['https://example.com/path', 'https://example.com/path'],
      ['', ''],
      [undefined, undefined],
    ])('strips URL hashes from %s', (url, expected) => {
      expect(stripUrlHash(url)).toEqual(expected)
    })
  })
  describe.skip('retriable', () => {
    it('should do something', () => {})
  })
  describe('currentTimestamp', () => {
    it('should get the timestamp', () => {
      expect(currentTimestamp()).toEqual(Date.now())
    })
  })
  describe('currentISOTime', () => {
    it('should get the iso time', () => {
      jest.setSystemTime(new Date('2022-01-01'))
      expect(currentISOTime()).toEqual('2022-01-01T00:00:00.000Z')
    })
  })
})
