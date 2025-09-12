import { assert, removeTrailingSlash, currentISOTime, currentTimestamp } from '../src/utils'

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
