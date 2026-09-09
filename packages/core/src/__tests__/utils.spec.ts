import {
  isUrl,
  assert,
  removeTrailingSlash,
  stripUrlHash,
  currentISOTime,
  currentTimestamp,
  raceWithTimeout,
} from '@/utils'

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
  describe('isUrl', () => {
    it.each([
      ['https://example.com/category?token=value#section', true],
      ['HTTP://example.com/category', true],
      ['//example.com/category', true],
      ['/category?token=value', true],
      ['./category', true],
      ['../category', true],
      ['  https://example.com/category  ', true],
      ['/', true],
      ['https://', true],
      ['Camera', false],
      ['Camera: Pro', false],
      ['Books/Fiction', false],
      ['Visit https://example.com', false],
      ['mailto:hello@example.com', false],
      ['#section', false],
      ['?query=value', false],
      ['', false],
      ['   ', false],
      [null, false],
      [undefined, false],
      [123, false],
      [true, false],
      [{ href: 'https://example.com' }, false],
      [['https://example.com'], false],
    ])('detects URL prefixes in %j: %s', (value, expected) => {
      expect(isUrl(value)).toBe(expected)
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
  describe('raceWithTimeout', () => {
    it('returns the promise value and clears the timeout when the promise resolves first', async () => {
      const onTimeout = vi.fn()

      await expect(raceWithTimeout(Promise.resolve('done'), 1000, onTimeout)).resolves.toBe('done')

      expect(onTimeout).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('resolves and invokes the callback when the timeout wins', async () => {
      const onTimeout = vi.fn()
      const result = raceWithTimeout(new Promise<never>(() => {}), 1000, onTimeout)

      await vi.advanceTimersByTimeAsync(1000)

      await expect(result).resolves.toBeUndefined()
      expect(onTimeout).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('rejects when the timeout callback throws', async () => {
      const error = new Error('timed out')
      const result = raceWithTimeout(new Promise<never>(() => {}), 1000, () => {
        throw error
      })
      const expectation = expect(result).rejects.toBe(error)

      await vi.advanceTimersByTimeAsync(1000)

      await expectation
      expect(vi.getTimerCount()).toBe(0)
    })

    it('preserves a promise rejection and clears the timeout', async () => {
      const error = new Error('failed')
      const onTimeout = vi.fn()

      await expect(raceWithTimeout(Promise.reject(error), 1000, onTimeout)).rejects.toBe(error)

      expect(onTimeout).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    })
  })
  describe('currentTimestamp', () => {
    it('should get the timestamp', () => {
      expect(currentTimestamp()).toEqual(Date.now())
    })
  })
  describe('currentISOTime', () => {
    it('should get the iso time', () => {
      vi.setSystemTime(new Date('2022-01-01'))
      expect(currentISOTime()).toEqual('2022-01-01T00:00:00.000Z')
    })
  })
})
