import { uuid7ToTimestampMs, uuidv7 } from '../../src/utils/uuidv7'

describe('uuidv7 utils', () => {
    it('exports a uuidv7 generator', () => {
        expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    })

    it('extracts the timestamp from a UUIDv7', () => {
        expect(uuid7ToTimestampMs('0190f65b-1f80-7000-8000-000000000000')).toBe(parseInt('0190f65b1f80', 16))
    })

    it('throws for invalid UUIDs', () => {
        expect(() => uuid7ToTimestampMs('not-a-uuid')).toThrow('Not a valid UUID')
        expect(() => uuid7ToTimestampMs('0190f65b-1f80-4000-8000-000000000000')).toThrow('Not a UUIDv7')
    })

    describe('a broken clock', () => {
        const realNow = Date.now

        afterEach(() => {
            Date.now = realNow
        })

        it.each([
            ['before 1970', -1000],
            ['fractional', 1757160000000.5],
            ['NaN', NaN],
            ['Infinity', Infinity],
            ['past the 48-bit field', 0xffff_ffff_ffff + 1],
        ])('still generates a well-formed UUID when Date.now() is %s', (_label, value) => {
            Date.now = () => value as number

            expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
        })
    })
})
