import { doesSurveyUrlMatch } from '../posthog-surveys'
import { window } from '../utils/globals'

// Mock the window.location
const mockWindowLocation = (href: string | undefined) => {
    Object.defineProperty(window, 'location', {
        value: { href },
        writable: true,
    })
}

describe('doesSurveyUrlMatch', () => {
    beforeEach(() => {
        // Reset window.location before each test
        mockWindowLocation(undefined)
    })

    it('should return true when no URL conditions are set', () => {
        const survey = { conditions: { events: null, actions: null } }
        expect(doesSurveyUrlMatch(survey)).toBe(true)

        const surveyWithNullConditions = { conditions: { url: null, events: null, actions: null } }
        expect(doesSurveyUrlMatch(surveyWithNullConditions)).toBe(true)
    })

    it('should return false when window.location.href is not available', () => {
        const survey = { conditions: { url: 'example.com', events: null, actions: null } }
        expect(doesSurveyUrlMatch(survey)).toBe(false)
    })

    describe('URL matching types', () => {
        beforeEach(() => {
            mockWindowLocation('https://example.com/path')
        })

        it('should match using icontains (default) match type', () => {
            const survey = { conditions: { url: 'example.com', events: null, actions: null } }
            expect(doesSurveyUrlMatch(survey)).toBe(true)

            const nonMatchingSurvey = { conditions: { url: 'nonexistent.com', events: null, actions: null } }
            expect(doesSurveyUrlMatch(nonMatchingSurvey)).toBe(false)
        })

        it('should match using explicit icontains match type', () => {
            const survey = {
                conditions: {
                    url: 'example.com',
                    urlMatchType: 'icontains' as const,
                    events: null,
                    actions: null,
                },
            }
            expect(doesSurveyUrlMatch(survey)).toBe(true)

            const caseInsensitiveSurvey = {
                conditions: {
                    url: 'EXAMPLE.COM',
                    urlMatchType: 'icontains' as const,
                    events: null,
                    actions: null,
                },
            }
            expect(doesSurveyUrlMatch(caseInsensitiveSurvey)).toBe(true)
        })

        it('should match using not_icontains match type', () => {
            const survey = {
                conditions: {
                    url: 'nonexistent.com',
                    urlMatchType: 'not_icontains' as const,
                    events: null,
                    actions: null,
                },
            }
            expect(doesSurveyUrlMatch(survey)).toBe(true)

            const nonMatchingSurvey = {
                conditions: {
                    url: 'example.com',
                    urlMatchType: 'not_icontains' as const,
                    events: null,
                    actions: null,
                },
            }
            expect(doesSurveyUrlMatch(nonMatchingSurvey)).toBe(false)
        })

        it('should match using regex match type', () => {
            const survey = {
                conditions: {
                    url: '^https://.*\\.com/.*$',
                    urlMatchType: 'regex' as const,
                    events: null,
                    actions: null,
                },
            }
            expect(doesSurveyUrlMatch(survey)).toBe(true)

            const nonMatchingSurvey = {
                conditions: {
                    url: '^https://.*\\.org/.*$',
                    urlMatchType: 'regex' as const,
                    events: null,
                    actions: null,
                },
            }
            expect(doesSurveyUrlMatch(nonMatchingSurvey)).toBe(false)
        })

        it('should match using not_regex match type', () => {
            const survey = {
                conditions: {
                    url: '^https://.*\\.org/.*$',
                    urlMatchType: 'not_regex' as const,
                    events: null,
                    actions: null,
                },
            }
            expect(doesSurveyUrlMatch(survey)).toBe(true)

            const nonMatchingSurvey = {
                conditions: {
                    url: '^https://.*\\.com/.*$',
                    urlMatchType: 'not_regex' as const,
                    events: null,
                    actions: null,
                },
            }
            expect(doesSurveyUrlMatch(nonMatchingSurvey)).toBe(false)
        })

        it('should match using exact match type', () => {
            mockWindowLocation('https://example.com')

            const survey = {
                conditions: {
                    url: 'https://example.com',
                    urlMatchType: 'exact' as const,
                    events: null,
                    actions: null,
                },
            }
            expect(doesSurveyUrlMatch(survey)).toBe(true)

            const nonMatchingSurvey = {
                conditions: {
                    url: 'https://example.com/path',
                    urlMatchType: 'exact' as const,
                    events: null,
                    actions: null,
                },
            }
            expect(doesSurveyUrlMatch(nonMatchingSurvey)).toBe(false)
        })

        it('should match using is_not match type', () => {
            mockWindowLocation('https://example.com')

            const survey = {
                conditions: {
                    url: 'https://other.com',
                    urlMatchType: 'is_not' as const,
                    events: null,
                    actions: null,
                },
            }
            expect(doesSurveyUrlMatch(survey)).toBe(true)

            const nonMatchingSurvey = {
                conditions: {
                    url: 'https://example.com',
                    urlMatchType: 'is_not' as const,
                    events: null,
                    actions: null,
                },
            }
            expect(doesSurveyUrlMatch(nonMatchingSurvey)).toBe(false)
        })
    })
})
