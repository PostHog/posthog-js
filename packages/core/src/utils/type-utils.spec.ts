import { isEvent, isNumber, isPositiveNumber } from './type-utils'

describe('type-utils', () => {
  describe('isNumber', () => {
    it.each([
      [1, true],
      [0, true],
      [-1, true],
      [0.1, true],
      [Infinity, true],
      [-Infinity, true],
      [NaN, false],
      [null, false],
      [undefined, false],
      ['1', false],
      [{}, false],
    ])('isNumber(%p) returns %p', (value, expected) => {
      expect(isNumber(value)).toBe(expected)
    })
  })

  describe('isEvent', () => {
    it('returns false without throwing when Event global is undefined', () => {
      const originalEvent = globalThis.Event
      try {
        delete globalThis.Event
        expect(() => isEvent(new Error('test'))).not.toThrow()
        expect(isEvent(new Error('test'))).toBe(false)
      } finally {
        globalThis.Event = originalEvent
      }
    })

    it('returns true for Event instances when Event global exists', () => {
      if (typeof Event !== 'undefined') {
        expect(isEvent(new Event('test'))).toBe(true)
      }
    })

    it('returns false for non-Event values', () => {
      expect(isEvent(new Error('test'))).toBe(false)
      expect(isEvent('string')).toBe(false)
      expect(isEvent({})).toBe(false)
      expect(isEvent(null)).toBe(false)
      expect(isEvent(undefined)).toBe(false)
    })
  })

  describe('isPositiveNumber', () => {
    it.each([
      [1, true],
      [0.1, true],
      [Infinity, true],
      [0, false],
      [-1, false],
      [NaN, false],
      [null, false],
      [undefined, false],
      ['1', false],
      [{}, false],
    ])('isPositiveNumber(%p) returns %p', (value, expected) => {
      expect(isPositiveNumber(value)).toBe(expected)
    })
  })
})
