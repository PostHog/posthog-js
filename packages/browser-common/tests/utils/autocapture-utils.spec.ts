import { makeSafeText, shouldCaptureValue, splitClassString } from '../../src/utils/autocapture-utils'

describe('autocapture utils', () => {
    describe('splitClassString', () => {
        it('splits classes on whitespace and trims empty values', () => {
            expect(splitClassString('  foo   bar\n baz  ')).toEqual(['foo', 'bar', 'baz'])
        })

        it('returns an empty array for an empty string', () => {
            expect(splitClassString('')).toEqual([])
        })
    })

    describe('makeSafeText', () => {
        it('normalizes whitespace', () => {
            expect(makeSafeText('  Why\n hello   there  ')).toBe('Why hello there')
        })

        it('removes values that look sensitive', () => {
            expect(makeSafeText('card 4111111111111111 ok')).toBe('card ok')
        })

        it('returns null for nullish input', () => {
            expect(makeSafeText(null)).toBeNull()
            expect(makeSafeText(undefined)).toBeNull()
        })
    })

    describe('shouldCaptureValue', () => {
        it('does not capture likely credit card numbers or SSNs', () => {
            expect(shouldCaptureValue('4111111111111111')).toBe(false)
            expect(shouldCaptureValue('123-45-6789')).toBe(false)
        })

        it('captures regular text values', () => {
            expect(shouldCaptureValue('save changes')).toBe(true)
        })
    })
})
