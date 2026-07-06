import { uuidv7 } from '../vendor/uuidv7'

const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('uuidv7', () => {
  it('generates a valid UUIDv7 string', () => {
    expect(uuidv7()).toMatch(UUID_V7_REGEX)
  })

  // A broken environment must never make id generation throw (it funnels every
  // SDK call — session/anonymous ids, lifecycle captures — so a throw
  // crash-loops the host app), and it must still yield a **v7** UUID: session
  // tracking and id bootstrapping depend on the v7 version, so degrading to
  // another version is not an acceptable fallback.
  describe.each([
    // Out-of-spec Math.random() (spec is [0, 1)); observed on real Android hardware.
    ['Math.random() returns a value >= 1', () => jest.spyOn(Math, 'random').mockReturnValue(1)],
    ['Math.random() returns NaN', () => jest.spyOn(Math, 'random').mockReturnValue(NaN)],
    // Clobbered clock, e.g. a legacy Date polyfill on the host page (see #710).
    ['Date.now() returns NaN', () => jest.spyOn(Date, 'now').mockReturnValue(NaN)],
    ['Date.now() returns a non-48-bit value', () => jest.spyOn(Date, 'now').mockReturnValue(-1)],
  ])('when %s', (_label, mock) => {
    it('still returns a valid v7 UUID and does not throw, then recovers', () => {
      const spy = mock()
      try {
        expect(uuidv7()).toMatch(UUID_V7_REGEX)
      } finally {
        spy.mockRestore()
      }
      // the generator is not left in a broken state once the environment recovers
      expect(uuidv7()).toMatch(UUID_V7_REGEX)
    })
  })
})
