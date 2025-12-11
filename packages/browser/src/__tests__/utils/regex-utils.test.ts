import { toExactMatch } from '../../utils/regex-utils'

describe('toExactMatch', () => {
    it('should anchor regex patterns correctly', () => {
        const unanchoredRegex = /test\d+/
        const anchoredRegex = toExactMatch(unanchoredRegex)
        expect(anchoredRegex.source).toBe('^(?:test\\d+)$')
    })

    it('should preserve flags from the original regex', () => {
        const unanchoredRegex = /test\d+/gi
        const anchoredRegex = toExactMatch(unanchoredRegex)
        expect(anchoredRegex.flags).toBe('gi')
    })

    it('should match exact strings only', () => {
        const unanchoredRegex = /hello/
        const anchoredRegex = toExactMatch(unanchoredRegex)

        expect(unanchoredRegex.test('hello')).toBe(true)
        expect(anchoredRegex.test('hello')).toBe(true)

        expect(unanchoredRegex.test('hello world')).toBe(true)
        expect(anchoredRegex.test('hello world')).toBe(false)

        expect(unanchoredRegex.test('hi there')).toBe(false)
        expect(anchoredRegex.test('hi there')).toBe(false)
    })

    it('should handle complex patterns', () => {
        const unanchoredRegex = /\d{3}-\d{2}-\d{4}/
        const anchoredRegex = toExactMatch(unanchoredRegex)

        expect(unanchoredRegex.test('123-45-6789')).toBe(true)
        expect(anchoredRegex.test('123-45-6789')).toBe(true)

        expect(unanchoredRegex.test('SSN: 123-45-6789')).toBe(true)
        expect(anchoredRegex.test('My SSN is 123-45-6789')).toBe(false)

        expect(unanchoredRegex.test('123456789')).toBe(false)
        expect(anchoredRegex.test('123456789')).toBe(false)
    })
})
