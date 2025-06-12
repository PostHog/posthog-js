import {
    canActivateRepeatedly,
    doesSurveyUrlMatch,
    getFontFamily,
    getSurveySeen,
    hasEvents,
    hasWaitPeriodPassed,
} from '../../extensions/surveys/surveys-extension-utils'
import { Survey, SurveySchedule, SurveyType } from '../../posthog-surveys-types'
import { SURVEY_IN_PROGRESS_PREFIX, SURVEY_SEEN_PREFIX } from '../../utils/survey-utils'

describe('hasWaitPeriodPassed', () => {
    let originalDate: DateConstructor
    let mockCurrentDate: Date

    beforeEach(() => {
        // Clear localStorage before each test
        localStorage.clear()

        // Store the original Date constructor
        originalDate = global.Date
        // Mock the current date to be 2025-01-15 12:00:00 UTC
        mockCurrentDate = new Date('2025-01-15T12:00:00Z')

        global.Date = class extends Date {
            constructor(date?: string | number | Date) {
                if (date) {
                    super(date)
                    return new originalDate(date)
                }
                super()
                return mockCurrentDate
            }
        } as DateConstructor
    })

    afterEach(() => {
        // Restore the original Date constructor
        global.Date = originalDate
        // Clear localStorage after each test
        localStorage.clear()
    })

    it('should return true when no wait period is specified', () => {
        localStorage.setItem('lastSeenSurveyDate', '2025-01-01T12:00:00Z')
        expect(hasWaitPeriodPassed(undefined)).toBe(true)
    })

    it('should return true when no last seen date is stored', () => {
        expect(hasWaitPeriodPassed(7)).toBe(true)
    })

    it('should return false when less than wait period has passed', () => {
        localStorage.setItem('lastSeenSurveyDate', '2025-01-10T12:00:00Z') // 5 days ago
        expect(hasWaitPeriodPassed(7)).toBe(false)
    })

    it('should return false when exactly the wait period has passed', () => {
        localStorage.setItem('lastSeenSurveyDate', '2025-01-08T12:00:00Z') // exactly 7 days ago
        expect(hasWaitPeriodPassed(7)).toBe(false)
    })

    it('should return true when more than wait period has passed', () => {
        localStorage.setItem('lastSeenSurveyDate', '2025-01-01T12:00:00Z') // 14 days ago
        expect(hasWaitPeriodPassed(7)).toBe(true)
    })

    it('should handle partial days by using Math.ceil', () => {
        localStorage.setItem('lastSeenSurveyDate', '2025-01-14T00:00:00Z') // 1.5 days ago
        expect(hasWaitPeriodPassed(1)).toBe(true) // Math.ceil(1.5) = 2, which is > 1
    })

    it('should return false for invalid date strings', () => {
        localStorage.setItem('lastSeenSurveyDate', 'invalid-date')
        expect(hasWaitPeriodPassed(7)).toBe(false)
    })

    it('should return false when just a few hours have passed', () => {
        localStorage.setItem('lastSeenSurveyDate', '2025-01-15T06:00:00Z') // 6 hours ago
        expect(hasWaitPeriodPassed(1)).toBe(false) // Math.ceil(0.25) = 1, which is not > 1
    })

    it('should return true when slightly more than wait period has passed', () => {
        localStorage.setItem('lastSeenSurveyDate', '2025-01-08T11:59:59Z') // 7 days and 1 second ago
        expect(hasWaitPeriodPassed(7)).toBe(true)
    })
})

describe('getSurveySeen', () => {
    beforeEach(() => {
        // Clear localStorage before each test
        localStorage.clear()
    })

    afterEach(() => {
        // Clear localStorage after each test
        localStorage.clear()
    })

    const baseSurvey: Survey = {
        id: 'test-survey',
        name: 'Test Survey',
        description: 'Test Description',
        type: SurveyType.Popover,
        questions: [],
        appearance: null,
        conditions: null,
        start_date: null,
        end_date: null,
        current_iteration: null,
        current_iteration_start_date: null,
        feature_flag_keys: null,
        linked_flag_key: null,
        targeting_flag_key: null,
        internal_targeting_flag_key: null,
    }

    describe('when survey has not been seen', () => {
        it('should return false when no localStorage entry exists', () => {
            expect(getSurveySeen(baseSurvey)).toBe(false)
        })
    })

    describe('when survey has been seen', () => {
        it('should return true for non-repeatable survey', () => {
            localStorage.setItem(`${SURVEY_SEEN_PREFIX}${baseSurvey.id}`, 'true')
            expect(getSurveySeen(baseSurvey)).toBe(true)
        })

        it('should return false for survey with SurveySchedule.Always', () => {
            const repeatableSurvey: Survey = {
                ...baseSurvey,
                schedule: SurveySchedule.Always,
            }
            localStorage.setItem(`${SURVEY_SEEN_PREFIX}${repeatableSurvey.id}`, 'true')
            expect(getSurveySeen(repeatableSurvey)).toBe(false)
        })

        it('should return false for survey with repeatedActivation events', () => {
            const eventRepeatableSurvey: Survey = {
                ...baseSurvey,
                conditions: {
                    events: {
                        repeatedActivation: true,
                        values: [{ name: 'test-event' }],
                    },
                    actions: null,
                },
            }
            localStorage.setItem(`${SURVEY_SEEN_PREFIX}${eventRepeatableSurvey.id}`, 'true')
            expect(getSurveySeen(eventRepeatableSurvey)).toBe(false)
        })

        it('should return true for survey with events but no repeatedActivation', () => {
            const nonRepeatableSurvey: Survey = {
                ...baseSurvey,
                conditions: {
                    events: {
                        repeatedActivation: false,
                        values: [{ name: 'test-event' }],
                    },
                    actions: null,
                },
            }
            localStorage.setItem(`${SURVEY_SEEN_PREFIX}${nonRepeatableSurvey.id}`, 'true')
            expect(getSurveySeen(nonRepeatableSurvey)).toBe(true)
        })

        it('should return true for survey with events but repeatedActivation undefined', () => {
            const nonRepeatableSurvey: Survey = {
                ...baseSurvey,
                conditions: {
                    events: {
                        values: [{ name: 'test-event' }],
                    },
                    actions: null,
                },
            }
            localStorage.setItem(`${SURVEY_SEEN_PREFIX}${nonRepeatableSurvey.id}`, 'true')
            expect(getSurveySeen(nonRepeatableSurvey)).toBe(true)
        })

        it('should return false for survey that is in progress', () => {
            const surveyInProgress = {
                ...baseSurvey,
                id: 'survey-in-progress',
            }

            // Mock survey as in progress by setting the in-progress key
            localStorage.setItem(
                `${SURVEY_IN_PROGRESS_PREFIX}${surveyInProgress.id}`,
                JSON.stringify({
                    surveySubmissionId: 'test-submission-id',
                })
            )
            localStorage.setItem(`${SURVEY_SEEN_PREFIX}${surveyInProgress.id}`, 'true')

            expect(getSurveySeen(surveyInProgress)).toBe(false)
        })
    })

    describe('with current_iteration', () => {
        it('should use iteration-specific key when current_iteration is set', () => {
            const surveyWithIteration = {
                ...baseSurvey,
                id: 'survey-with-iteration',
                current_iteration: 2,
            }

            // Set the iteration-specific key
            localStorage.setItem(
                `${SURVEY_SEEN_PREFIX}${surveyWithIteration.id}_${surveyWithIteration.current_iteration}`,
                'true'
            )
            expect(getSurveySeen(surveyWithIteration)).toBe(true)

            // Should not be affected by the base key
            localStorage.setItem(`${SURVEY_SEEN_PREFIX}${surveyWithIteration.id}`, 'true')
            expect(getSurveySeen(surveyWithIteration)).toBe(true)
        })

        it('should return false when iteration-specific key is not set', () => {
            const surveyWithIteration = {
                ...baseSurvey,
                id: 'survey-with-iteration',
                current_iteration: 2,
            }

            // Set only the base key, not the iteration-specific key
            localStorage.setItem(`${SURVEY_SEEN_PREFIX}${surveyWithIteration.id}`, 'true')
            expect(getSurveySeen(surveyWithIteration)).toBe(false)
        })

        it('should handle current_iteration of 0 correctly', () => {
            const surveyWithZeroIteration = {
                ...baseSurvey,
                id: 'survey-zero-iteration',
                current_iteration: 0,
            }

            // Should use base key when current_iteration is 0
            localStorage.setItem(`${SURVEY_SEEN_PREFIX}${surveyWithZeroIteration.id}`, 'true')
            expect(getSurveySeen(surveyWithZeroIteration)).toBe(true)
        })
    })
})

describe('hasEvents', () => {
    it('should return false when survey has no conditions', () => {
        const survey = {
            conditions: undefined,
        } as Pick<Survey, 'conditions'>
        expect(hasEvents(survey)).toBe(false)
    })

    it('should return false when survey has no events', () => {
        const survey = {
            conditions: {
                events: undefined,
                actions: { values: [] },
            },
        } as Pick<Survey, 'conditions'>
        expect(hasEvents(survey)).toBe(false)
    })

    it('should return false when survey has empty events values', () => {
        const survey = {
            conditions: {
                events: {
                    values: [],
                },
                actions: { values: [] },
            },
        } as Pick<Survey, 'conditions'>
        expect(hasEvents(survey)).toBe(false)
    })

    it('should return true when survey has events values', () => {
        const survey = {
            conditions: {
                events: {
                    values: [{ name: 'event1' }, { name: 'event2' }],
                },
                actions: { values: [] },
            },
        } as Pick<Survey, 'conditions'>
        expect(hasEvents(survey)).toBe(true)
    })
})

describe('canActivateRepeatedly', () => {
    it('should return true when survey the schedule is Always', () => {
        const survey = {
            id: 'test-survey',
            schedule: SurveySchedule.Always,
            conditions: undefined,
            current_iteration: null,
        } as Pick<Survey, 'id' | 'schedule' | 'conditions' | 'current_iteration'>
        expect(canActivateRepeatedly(survey)).toBe(true)
    })

    it('should return false when survey has no events', () => {
        const survey = {
            id: 'test-survey',
            schedule: SurveySchedule.Once,
            current_iteration: null,
            conditions: {
                events: {
                    repeatedActivation: true,
                    values: [],
                },
                actions: { values: [] },
            },
        } as Pick<Survey, 'id' | 'schedule' | 'conditions' | 'current_iteration'>
        expect(canActivateRepeatedly(survey)).toBe(false)
    })

    it('should return true when survey has events and repeatedActivation is true', () => {
        const survey = {
            id: 'test-survey',
            schedule: SurveySchedule.Once,
            current_iteration: null,
            conditions: {
                events: {
                    repeatedActivation: true,
                    values: [{ name: 'event1' }],
                },
                actions: { values: [] },
            },
        } as Pick<Survey, 'id' | 'schedule' | 'conditions' | 'current_iteration'>
        expect(canActivateRepeatedly(survey)).toBe(true)
    })

    it('should return false when survey has events but repeatedActivation is false', () => {
        const survey = {
            id: 'test-survey',
            schedule: SurveySchedule.Once,
            current_iteration: null,
            conditions: {
                events: {
                    repeatedActivation: false,
                    values: [{ name: 'event1' }],
                },
                actions: { values: [] },
            },
        } as Pick<Survey, 'id' | 'schedule' | 'conditions' | 'current_iteration'>
        expect(canActivateRepeatedly(survey)).toBe(false)
    })
})

describe('getFontFamily', () => {
    it('should return the default font family with fallbacks when no font family is provided', () => {
        expect(getFontFamily()).toBe(
            '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", "Roboto", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"'
        )
    })

    it('should return the provided font family with fallbacks when a custom font family is provided', () => {
        expect(getFontFamily('Arial')).toBe(
            'Arial, BlinkMacSystemFont, "Inter", "Segoe UI", "Roboto", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"'
        )
    })

    it('should return only "inherit" when "inherit" is provided as font family', () => {
        expect(getFontFamily('inherit')).toBe('inherit')
    })
})

describe('doesSurveyUrlMatch', () => {
    const mockWindowLocation = (href: string | undefined) => {
        Object.defineProperty(window, 'location', {
            value: { href },
            writable: true,
        })
    }
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
