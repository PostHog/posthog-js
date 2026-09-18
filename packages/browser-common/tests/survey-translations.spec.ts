import { detectUserLanguage } from '../src/surveys/survey-translations'
import { createSurveyRenderContext as host } from './helpers/survey-render-context'

afterEach(() => vi.unstubAllGlobals())

describe('detectUserLanguage', () => {
    it.each([undefined, ''])('falls back to userLanguage when language is %s', (language) => {
        vi.stubGlobal('navigator', { language, userLanguage: 'fr-CA' })
        expect(detectUserLanguage(host())).toBe('fr-CA')
    })

    it('prefers navigator.language over userLanguage', () => {
        vi.stubGlobal('navigator', { language: 'en-US', userLanguage: 'fr-CA' })
        expect(detectUserLanguage(host())).toBe('en-US')
    })

    it.each([
        ['configured override', 'de', { language: 'es' }, 'de'],
        ['person language', undefined, { language: 'es' }, 'es'],
    ] as const)('prefers %s over userLanguage', (_name, overrideLanguage, storedPersonProperties, expected) => {
        vi.stubGlobal('navigator', { userLanguage: 'fr-CA' })
        expect(detectUserLanguage(host({ overrideLanguage, storedPersonProperties }))).toBe(expected)
    })

    it('handles an absent navigator and preserves overrides', () => {
        vi.stubGlobal('navigator', undefined)
        expect(detectUserLanguage(host())).toBeNull()
        expect(detectUserLanguage(host({ overrideLanguage: 'de', storedPersonProperties: { language: 'es' } }))).toBe(
            'de'
        )
        expect(detectUserLanguage(host({ storedPersonProperties: { language: 'es' } }))).toBe('es')
    })

    it('returns null when neither browser language is available', () => {
        vi.stubGlobal('navigator', {})
        expect(detectUserLanguage(host())).toBeNull()
    })

    it('reads the current browser language on each invocation', () => {
        vi.stubGlobal('navigator', undefined)
        expect(detectUserLanguage(host())).toBeNull()
        vi.stubGlobal('navigator', { userLanguage: 'fr-CA' })
        expect(detectUserLanguage(host())).toBe('fr-CA')
        vi.stubGlobal('navigator', { language: 'de' })
        expect(detectUserLanguage(host())).toBe('de')
    })
})
