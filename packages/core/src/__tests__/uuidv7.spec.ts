import { uuidv7 } from '../vendor/uuidv7'

const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('uuidv7', () => {
  it('generates a valid UUIDv7 string', () => {
    expect(uuidv7()).toMatch(UUID_V7_REGEX)
  })

  it('falls back to a UUIDv4 string when the v7 generator throws, then recovers', () => {
    // Out-of-spec Math.random() implementations (broken device RNGs, or pages
    // where another script clobbers Math.random — see #710 for the Date.now()
    // equivalent) produce out-of-range field values, making
    // V7Generator.generate() throw `RangeError: invalid field value`.
    const spy = jest.spyOn(Math, 'random').mockReturnValue(1) // spec says [0, 1)
    try {
      expect(uuidv7()).toMatch(UUID_V4_REGEX)
    } finally {
      spy.mockRestore()
    }
    // the generator is not left in a broken state once the environment recovers
    expect(uuidv7()).toMatch(UUID_V7_REGEX)
  })
})
