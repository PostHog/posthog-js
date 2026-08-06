import { extractHref, extractTexts, matchString, matchTexts } from '../../src/utils/elements-chain-utils'

describe('elements-chain-utils', () => {
    describe('extractHref', () => {
        it('extracts href from an elements chain', () => {
            expect(extractHref('a:href="https://example.com"text="Click me"')).toBe('https://example.com')
        })

        it('returns an empty string when no href is present', () => {
            expect(extractHref('button:text="Click"')).toBe('')
        })
    })

    describe('extractTexts', () => {
        it('extracts all text values from an elements chain', () => {
            expect(extractTexts('div:text="Outer";button:text="Click me"')).toEqual(['Outer', 'Click me'])
        })

        it('deduplicates identical text values', () => {
            expect(extractTexts('button:text="Click";span:text="Click";div:text="Other"')).toEqual(['Click', 'Other'])
        })
    })

    describe('matchString', () => {
        it('matches exact values', () => {
            expect(matchString('Click me', 'Click me', 'exact')).toBe(true)
            expect(matchString('Click me', 'click me', 'exact')).toBe(false)
        })

        it('matches contains patterns case-insensitively with SQL-like wildcards', () => {
            expect(matchString('Click me', 'click', 'contains')).toBe(true)
            expect(matchString('Click me', 'Cl_ck%', 'contains')).toBe(true)
        })

        it('matches regex patterns and returns false for invalid regex', () => {
            expect(matchString('/docs/getting-started', '^/docs/', 'regex')).toBe(true)
            expect(matchString('hello', '[invalid', 'regex')).toBe(false)
        })
    })

    describe('matchTexts', () => {
        it('matches if any text matches', () => {
            expect(matchTexts(['Outer', 'Click me'], 'click', 'contains')).toBe(true)
        })

        it('does not match when no text matches', () => {
            expect(matchTexts(['Outer', 'Click me'], 'submit', 'contains')).toBe(false)
        })
    })
})
