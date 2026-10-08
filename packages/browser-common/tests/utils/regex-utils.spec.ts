import { isMatchingRegex, isValidRegex } from '../../src/utils/regex-utils'

describe('regex utils', () => {
    describe('isValidRegex', () => {
        it('returns true for valid regex patterns', () => {
            expect(isValidRegex('^/docs/.*')).toBe(true)
        })

        it('returns false for invalid regex patterns', () => {
            expect(isValidRegex('[invalid')).toBe(false)
        })
    })

    describe('isMatchingRegex', () => {
        it('matches valid regex patterns', () => {
            expect(isMatchingRegex('/docs/getting-started', '^/docs/')).toBe(true)
            expect(isMatchingRegex('/pricing', '^/docs/')).toBe(false)
        })

        it('returns false for invalid regex patterns', () => {
            expect(isMatchingRegex('/docs', '[invalid')).toBe(false)
        })
    })
})
