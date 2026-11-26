/// <reference lib="dom" />

import { extractHref, extractTexts, matchString, matchTexts } from '@posthog/browser-common/utils/elements-chain-utils'

describe('elements-chain-utils', () => {
    describe('extractHref', () => {
        it('extracts href from elements chain', () => {
            expect(extractHref('a:href="https://example.com"text="Click me"')).toBe('https://example.com')
        })

        it('returns empty string when no href present', () => {
            expect(extractHref('button:text="Click"')).toBe('')
        })

        it('handles href with query params', () => {
            expect(extractHref('a:href="https://example.com/path?foo=bar&baz=qux"')).toBe(
                'https://example.com/path?foo=bar&baz=qux'
            )
        })
    })

    describe('extractTexts', () => {
        it('extracts multiple texts from elements chain', () => {
            expect(extractTexts('button:text="Click";span:text="Hello"')).toEqual(['Click', 'Hello'])
        })

        it('deduplicates identical texts', () => {
            expect(extractTexts('button:text="Click";span:text="Click";div:text="Other"')).toEqual(['Click', 'Other'])
        })

        it('returns empty array when no text present', () => {
            expect(extractTexts('div.container:attr__class="container"')).toEqual([])
        })
    })

    describe('matchString', () => {
        it('returns false for null/undefined', () => {
            expect(matchString(null, 'pattern', 'exact')).toBe(false)
            expect(matchString(undefined, 'pattern', 'contains')).toBe(false)
        })

        it('contains matching is case-insensitive', () => {
            expect(matchString('Hello World', 'WORLD', 'contains')).toBe(true)
        })

        it('returns false for invalid regex', () => {
            expect(matchString('hello', '[invalid', 'regex')).toBe(false)
        })

        it('returns false quickly for a regex that would backtrack catastrophically', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const start = Date.now()
            expect(matchString('a'.repeat(40) + '!', '^(a+)+$', 'regex')).toBe(false)
            expect(Date.now() - start).toBeLessThan(500)
            warnSpy.mockRestore()
        })
    })

    describe('matchTexts', () => {
        it('returns true when any text matches', () => {
            expect(matchTexts(['Click me', 'Submit'], 'submit', 'contains')).toBe(true)
        })
    })
})
