import { V7Generator } from './uuidv7'

describe('uuidv7 default RNG', () => {
  const realRandom = Math.random

  afterEach(() => {
    Math.random = realRandom
  })

  it.each([
    ['exactly 1.0', 1.0],
    ['greater than 1', 1.5],
    ['NaN', NaN],
  ])('does not throw when Math.random() returns %s', (_label, value) => {
    Math.random = () => value
    const generator = new V7Generator()
    const uuid = generator.generate().toString()
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('still generates well-formed v7 UUIDs with the real Math.random', () => {
    const generator = new V7Generator()
    const uuid = generator.generate().toString()
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
