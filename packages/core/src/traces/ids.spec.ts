import { getRandomBytes, isValidSpanId, isValidTraceId, newSpanId, newTraceId } from './ids'

describe('trace and span ids', () => {
  describe('newTraceId', () => {
    it('is 32 lowercase hex characters', () => {
      for (let i = 0; i < 50; i++) {
        expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/)
      }
    })

    it('is never all zeros', () => {
      for (let i = 0; i < 50; i++) {
        expect(newTraceId()).not.toBe('0'.repeat(32))
      }
    })

    it('does not repeat', () => {
      const ids = new Set(Array.from({ length: 200 }, newTraceId))
      expect(ids.size).toBe(200)
    })
  })

  describe('newSpanId', () => {
    it('is 16 lowercase hex characters', () => {
      for (let i = 0; i < 50; i++) {
        expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/)
      }
    })

    it('does not repeat', () => {
      const ids = new Set(Array.from({ length: 200 }, newSpanId))
      expect(ids.size).toBe(200)
    })
  })

  describe('getRandomBytes', () => {
    it('returns the requested length', () => {
      expect(getRandomBytes(8)).toHaveLength(8)
      expect(getRandomBytes(16)).toHaveLength(16)
    })

    it('falls back to Math.random when crypto is unavailable', () => {
      const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
      // React Native has no global crypto without a polyfill — the fallback path
      // is what keeps span ids working there.
      Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true })
      try {
        expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/)
        expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/)
      } finally {
        if (original) {
          Object.defineProperty(globalThis, 'crypto', original)
        }
      }
    })

    it('falls back when getRandomValues throws', () => {
      const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
      Object.defineProperty(globalThis, 'crypto', {
        value: {
          getRandomValues: () => {
            throw new Error('not allowed')
          },
        },
        configurable: true,
      })
      try {
        expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/)
      } finally {
        if (original) {
          Object.defineProperty(globalThis, 'crypto', original)
        }
      }
    })

    it('never emits an all-zero id even when the random source is broken', () => {
      const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
      Object.defineProperty(globalThis, 'crypto', {
        value: { getRandomValues: (array: Uint8Array) => array.fill(0) },
        configurable: true,
      })
      try {
        // The server zeroes ids it can't use, so an all-zero id would be stored
        // and silently orphaned rather than rejected.
        expect(newTraceId()).not.toBe('0'.repeat(32))
        expect(newSpanId()).not.toBe('0'.repeat(16))
      } finally {
        if (original) {
          Object.defineProperty(globalThis, 'crypto', original)
        }
      }
    })
  })

  describe('validation', () => {
    it.each([
      ['a valid trace id', '4bf92f3577b34da6a3ce929d0e0e4736', true],
      ['an all-zero trace id', '0'.repeat(32), false],
      ['a short trace id', 'abc', false],
      ['uppercase hex', '4BF92F3577B34DA6A3CE929D0E0E4736', false],
      ['a non-hex string', 'zzf92f3577b34da6a3ce929d0e0e4736', false],
      ['a non-string', 12345, false],
    ])('isValidTraceId rejects/accepts %s', (_name, value, expected) => {
      expect(isValidTraceId(value)).toBe(expected)
    })

    it.each([
      ['a valid span id', '00f067aa0ba902b7', true],
      ['an all-zero span id', '0'.repeat(16), false],
      ['a trace-length id', '4bf92f3577b34da6a3ce929d0e0e4736', false],
    ])('isValidSpanId rejects/accepts %s', (_name, value, expected) => {
      expect(isValidSpanId(value)).toBe(expected)
    })
  })
})
