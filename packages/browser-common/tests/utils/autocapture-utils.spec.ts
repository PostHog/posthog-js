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

        it('detects delimited credit card numbers in network bodies', () => {
            expect(shouldCaptureValue('{"card":"4242 4242 4242 4242"}', false)).toBe(false)
            expect(shouldCaptureValue('{"card":"4242-4242-4242-4242"}', false)).toBe(false)
            expect(shouldCaptureValue('{"card":"4556 617 778 508"}', false)).toBe(false)
            expect(shouldCaptureValue('{"card":"4222222222222"}', false)).toBe(false)
        })

        it('detects credit card numbers next to numeric metadata', () => {
            expect(shouldCaptureValue('{"card":"4242 4242 4242 4242 123"}', false)).toBe(false)
            expect(shouldCaptureValue('{"card":"123 4242 4242 4242 4242"}', false)).toBe(false)
            expect(shouldCaptureValue('{"card":"4242 4242 4242 4242 12345678901234567"}', false)).toBe(false)
        })

        it('does not treat invalid or identifier-like card numbers as sensitive in network bodies', () => {
            expect(shouldCaptureValue('{"id":"4242 4242 4242 4241"}', false)).toBe(true)
            expect(shouldCaptureValue('{"id":"prefix4242424242424242suffix"}', false)).toBe(true)
        })

        it('detects structurally valid, delimited SSNs and ITINs in network bodies', () => {
            expect(shouldCaptureValue('{"ssn":"123-45-6789"}', false)).toBe(false)
            expect(shouldCaptureValue('{"ssn":"123456789"}', false)).toBe(false)
            expect(shouldCaptureValue('{"ssn":"123-456789"}', false)).toBe(false)
            expect(shouldCaptureValue('{"ssn":"12345-6789"}', false)).toBe(false)
            expect(shouldCaptureValue('{"itin":"912-70-1234"}', false)).toBe(false)
        })

        it('does not treat timestamps, UUID fragments, or invalid SSN groups as sensitive in network bodies', () => {
            expect(shouldCaptureValue('{"version":"1785400913428"}', false)).toBe(true)
            expect(shouldCaptureValue('{"id":"a2086e30-2564-40d2-b260-074641cd3b89"}', false)).toBe(true)
            expect(shouldCaptureValue('{"ssn":"000-12-3456"}', false)).toBe(true)
            expect(shouldCaptureValue('{"ssn":"666-12-3456"}', false)).toBe(true)
            expect(shouldCaptureValue('{"ssn":"123-00-4567"}', false)).toBe(true)
            expect(shouldCaptureValue('{"ssn":"123-45-0000"}', false)).toBe(true)
        })

        it('captures regular text values', () => {
            expect(shouldCaptureValue('save changes')).toBe(true)
        })
    })
})
