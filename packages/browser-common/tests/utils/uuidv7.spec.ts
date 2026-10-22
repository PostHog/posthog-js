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

describe('lazy UUID random source', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
        vi.resetModules()
    })

    it.each(['crypto', 'fallback', 'deny-weak'] as const)('preserves the %s RNG policy at first use', async (mode) => {
        vi.resetModules()
        const random = vi.spyOn(Math, 'random').mockReturnValue(0.25)
        const strong = vi.fn((buffer: Uint32Array) => buffer.fill(42))
        vi.stubGlobal('window', mode === 'crypto' ? { crypto: { getRandomValues: strong } } : undefined)
        vi.stubGlobal('crypto', { getRandomValues: strong })
        vi.stubGlobal('UUIDV7_DENY_WEAK_RNG', mode === 'deny-weak')
        const module = await import('../../src/utils/uuidv7')
        expect(strong).not.toHaveBeenCalled()
        expect(random).not.toHaveBeenCalled()
        if (mode === 'deny-weak') {
            expect(() => module.uuidv7()).toThrow('no cryptographically strong RNG available')
        } else {
            const first = module.uuidv7()
            const second = module.uuidv7()
            expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
            expect(second > first).toBe(true)
            if (mode === 'crypto') {
                expect(strong).toHaveBeenCalledOnce()
                expect(random).not.toHaveBeenCalled()
            } else {
                expect(random).toHaveBeenCalled()
                expect(strong).not.toHaveBeenCalled()
            }
        }
    })
})
