// @vitest-environment jsdom
import '../helpers/surveys-setup'
import { createSurveyRenderContext } from '../helpers/survey-render-context'

import {
    addSurveyCSSVariablesToElement,
    canActivateRepeatedly,
    doesSurveyUrlMatch,
    getFontFamily,
    getSurveySeen,
    hasWaitPeriodPassed,
    sendSurveyEvent,
    setInProgressSurveyState,
    getInProgressSurveyState,
} from '../../src/surveys/surveys-extension-utils'
import { SurveySchedule, SurveyType } from '../../src/survey-constants'
import type { Survey } from '../../src/types/surveys'
import { SURVEY_IN_PROGRESS_PREFIX, SURVEY_LOGGER, SURVEY_SEEN_PREFIX } from '../../src/utils/survey-utils'

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
        expect(hasWaitPeriodPassed(undefined, localStorage)).toBe(true)
    })

    it('should return true when no last seen date is stored', () => {
        expect(hasWaitPeriodPassed(7, localStorage)).toBe(true)
    })

    it('should return false when less than wait period has passed', () => {
        localStorage.setItem('lastSeenSurveyDate', '2025-01-10T12:00:00Z') // 5 days ago
        expect(hasWaitPeriodPassed(7, localStorage)).toBe(false)
    })

    it('should return false when exactly the wait period has passed', () => {
        localStorage.setItem('lastSeenSurveyDate', '2025-01-08T12:00:00Z') // exactly 7 days ago
        expect(hasWaitPeriodPassed(7, localStorage)).toBe(false)
    })

    it('should return true when more than wait period has passed', () => {
        localStorage.setItem('lastSeenSurveyDate', '2025-01-01T12:00:00Z') // 14 days ago
        expect(hasWaitPeriodPassed(7, localStorage)).toBe(true)
    })

    it('should handle partial days by using Math.ceil', () => {
        localStorage.setItem('lastSeenSurveyDate', '2025-01-14T00:00:00Z') // 1.5 days ago
        expect(hasWaitPeriodPassed(1, localStorage)).toBe(true) // Math.ceil(1.5) = 2, which is > 1
    })

    it('should return false for invalid date strings', () => {
        localStorage.setItem('lastSeenSurveyDate', 'invalid-date')
        expect(hasWaitPeriodPassed(7, localStorage)).toBe(false)
    })

    it('should return false when just a few hours have passed', () => {
        localStorage.setItem('lastSeenSurveyDate', '2025-01-15T06:00:00Z') // 6 hours ago
        expect(hasWaitPeriodPassed(1, localStorage)).toBe(false) // Math.ceil(0.25) = 1, which is not > 1
    })

    it('should return true when slightly more than wait period has passed', () => {
        localStorage.setItem('lastSeenSurveyDate', '2025-01-08T11:59:59Z') // 7 days and 1 second ago
        expect(hasWaitPeriodPassed(7, localStorage)).toBe(true)
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
            expect(getSurveySeen(baseSurvey, localStorage)).toBe(false)
        })
    })

    describe('when survey has been seen', () => {
        it('should return true for non-repeatable survey', () => {
            localStorage.setItem(`${SURVEY_SEEN_PREFIX}${baseSurvey.id}`, 'true')
            expect(getSurveySeen(baseSurvey, localStorage)).toBe(true)
        })

        it('should return false for survey with SurveySchedule.Always', () => {
            const repeatableSurvey: Survey = {
                ...baseSurvey,
                schedule: SurveySchedule.Always,
            }
            localStorage.setItem(`${SURVEY_SEEN_PREFIX}${repeatableSurvey.id}`, 'true')
            expect(getSurveySeen(repeatableSurvey, localStorage)).toBe(false)
        })

        it('should return false for survey with repeatedActivation events', () => {
            const eventRepeatableSurvey: Survey = {
                ...baseSurvey,
                conditions: {
                    cancelEvents: null,
                    events: {
                        repeatedActivation: true,
                        values: [{ name: 'test-event' }],
                    },
                    actions: null,
                },
            }
            localStorage.setItem(`${SURVEY_SEEN_PREFIX}${eventRepeatableSurvey.id}`, 'true')
            expect(getSurveySeen(eventRepeatableSurvey, localStorage)).toBe(false)
        })

        it('should return true for survey with events but no repeatedActivation', () => {
            const nonRepeatableSurvey: Survey = {
                ...baseSurvey,
                conditions: {
                    cancelEvents: null,
                    events: {
                        repeatedActivation: false,
                        values: [{ name: 'test-event' }],
                    },
                    actions: null,
                },
            }
            localStorage.setItem(`${SURVEY_SEEN_PREFIX}${nonRepeatableSurvey.id}`, 'true')
            expect(getSurveySeen(nonRepeatableSurvey, localStorage)).toBe(true)
        })

        it('should return true for survey with events but repeatedActivation undefined', () => {
            const nonRepeatableSurvey: Survey = {
                ...baseSurvey,
                conditions: {
                    cancelEvents: null,
                    events: {
                        values: [{ name: 'test-event' }],
                    },
                    actions: null,
                },
            }
            localStorage.setItem(`${SURVEY_SEEN_PREFIX}${nonRepeatableSurvey.id}`, 'true')
            expect(getSurveySeen(nonRepeatableSurvey, localStorage)).toBe(true)
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

            expect(getSurveySeen(surveyInProgress, localStorage)).toBe(false)
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
            expect(getSurveySeen(surveyWithIteration, localStorage)).toBe(true)

            // Should not be affected by the base key
            localStorage.setItem(`${SURVEY_SEEN_PREFIX}${surveyWithIteration.id}`, 'true')
            expect(getSurveySeen(surveyWithIteration, localStorage)).toBe(true)
        })

        it('should return false when iteration-specific key is not set', () => {
            const surveyWithIteration = {
                ...baseSurvey,
                id: 'survey-with-iteration',
                current_iteration: 2,
            }

            // Set only the base key, not the iteration-specific key
            localStorage.setItem(`${SURVEY_SEEN_PREFIX}${surveyWithIteration.id}`, 'true')
            expect(getSurveySeen(surveyWithIteration, localStorage)).toBe(false)
        })

        it('should handle current_iteration of 0 correctly', () => {
            const surveyWithZeroIteration = {
                ...baseSurvey,
                id: 'survey-zero-iteration',
                current_iteration: 0,
            }

            // Should use base key when current_iteration is 0
            localStorage.setItem(`${SURVEY_SEEN_PREFIX}${surveyWithZeroIteration.id}`, 'true')
            expect(getSurveySeen(surveyWithZeroIteration, localStorage)).toBe(true)
        })
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
        expect(canActivateRepeatedly(survey, localStorage)).toBe(true)
    })

    it('should return false when survey has no events', () => {
        const survey = {
            id: 'test-survey',
            schedule: SurveySchedule.Once,
            current_iteration: null,
            conditions: {
                cancelEvents: null,
                events: {
                    repeatedActivation: true,
                    values: [],
                },
                actions: { values: [] },
            },
        } as Pick<Survey, 'id' | 'schedule' | 'conditions' | 'current_iteration'>
        expect(canActivateRepeatedly(survey, localStorage)).toBe(false)
    })

    it('should return true when survey has events and repeatedActivation is true', () => {
        const survey = {
            id: 'test-survey',
            schedule: SurveySchedule.Once,
            current_iteration: null,
            conditions: {
                cancelEvents: null,
                events: {
                    repeatedActivation: true,
                    values: [{ name: 'event1' }],
                },
                actions: { values: [] },
            },
        } as Pick<Survey, 'id' | 'schedule' | 'conditions' | 'current_iteration'>
        expect(canActivateRepeatedly(survey, localStorage)).toBe(true)
    })

    it('should return false when survey has events but repeatedActivation is false', () => {
        const survey = {
            id: 'test-survey',
            schedule: SurveySchedule.Once,
            current_iteration: null,
            conditions: {
                cancelEvents: null,
                events: {
                    repeatedActivation: false,
                    values: [{ name: 'event1' }],
                },
                actions: { values: [] },
            },
        } as Pick<Survey, 'id' | 'schedule' | 'conditions' | 'current_iteration'>
        expect(canActivateRepeatedly(survey, localStorage)).toBe(false)
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
    const host = createSurveyRenderContext()
    const mockTargetingUrl = (href: string | undefined) => {
        host.getTargetingUrl = () => href ?? ''
    }
    beforeEach(() => {
        // Reset the targeting URL before each test
        mockTargetingUrl(undefined)
    })

    it('should return true when no URL conditions are set', () => {
        const survey = { conditions: { cancelEvents: null, events: null, actions: null } }
        expect(doesSurveyUrlMatch(survey, host)).toBe(true)

        const surveyWithNullConditions = { conditions: { cancelEvents: null, url: null, events: null, actions: null } }
        expect(doesSurveyUrlMatch(surveyWithNullConditions, host)).toBe(true)
    })

    it('should return false when the targeting URL is not available', () => {
        const survey = { conditions: { cancelEvents: null, url: 'example.com', events: null, actions: null } }
        expect(doesSurveyUrlMatch(survey, host)).toBe(false)
    })

    describe('URL matching types', () => {
        beforeEach(() => {
            mockTargetingUrl('https://example.com/path')
        })

        it('should match using icontains (default) match type', () => {
            const survey = { conditions: { cancelEvents: null, url: 'example.com', events: null, actions: null } }
            expect(doesSurveyUrlMatch(survey, host)).toBe(true)

            const nonMatchingSurvey = {
                conditions: { cancelEvents: null, url: 'nonexistent.com', events: null, actions: null },
            }
            expect(doesSurveyUrlMatch(nonMatchingSurvey, host)).toBe(false)
        })

        it('should match using explicit icontains match type', () => {
            const survey = {
                conditions: {
                    cancelEvents: null,
                    url: 'example.com',
                    urlMatchType: 'icontains' as const,
                    events: null,
                    actions: null,
                },
            }
            expect(doesSurveyUrlMatch(survey, host)).toBe(true)

            const caseInsensitiveSurvey = {
                conditions: {
                    cancelEvents: null,
                    url: 'EXAMPLE.COM',
                    urlMatchType: 'icontains' as const,
                    events: null,
                    actions: null,
                },
            }
            expect(doesSurveyUrlMatch(caseInsensitiveSurvey, host)).toBe(true)
        })

        it('should match using not_icontains match type', () => {
            const survey = {
                conditions: {
                    cancelEvents: null,
                    url: 'nonexistent.com',
                    urlMatchType: 'not_icontains' as const,
                    events: null,
                    actions: null,
                },
            }
            expect(doesSurveyUrlMatch(survey, host)).toBe(true)

            const nonMatchingSurvey = {
                conditions: {
                    cancelEvents: null,
                    url: 'example.com',
                    urlMatchType: 'not_icontains' as const,
                    events: null,
                    actions: null,
                },
            }
            expect(doesSurveyUrlMatch(nonMatchingSurvey, host)).toBe(false)
        })

        it('should match using regex match type', () => {
            const survey = {
                conditions: {
                    cancelEvents: null,
                    url: '^https://.*\\.com/.*$',
                    urlMatchType: 'regex' as const,
                    events: null,
                    actions: null,
                },
            }
            expect(doesSurveyUrlMatch(survey, host)).toBe(true)

            const nonMatchingSurvey = {
                conditions: {
                    cancelEvents: null,
                    url: '^https://.*\\.org/.*$',
                    urlMatchType: 'regex' as const,
                    events: null,
                    actions: null,
                },
            }
            expect(doesSurveyUrlMatch(nonMatchingSurvey, host)).toBe(false)
        })

        it('should match using not_regex match type', () => {
            const survey = {
                conditions: {
                    cancelEvents: null,
                    url: '^https://.*\\.org/.*$',
                    urlMatchType: 'not_regex' as const,
                    events: null,
                    actions: null,
                },
            }
            expect(doesSurveyUrlMatch(survey, host)).toBe(true)

            const nonMatchingSurvey = {
                conditions: {
                    cancelEvents: null,
                    url: '^https://.*\\.com/.*$',
                    urlMatchType: 'not_regex' as const,
                    events: null,
                    actions: null,
                },
            }
            expect(doesSurveyUrlMatch(nonMatchingSurvey, host)).toBe(false)
        })

        it('should match using exact match type', () => {
            mockTargetingUrl('https://example.com')

            const survey = {
                conditions: {
                    cancelEvents: null,
                    url: 'https://example.com',
                    urlMatchType: 'exact' as const,
                    events: null,
                    actions: null,
                },
            }
            expect(doesSurveyUrlMatch(survey, host)).toBe(true)

            const nonMatchingSurvey = {
                conditions: {
                    cancelEvents: null,
                    url: 'https://example.com/path',
                    urlMatchType: 'exact' as const,
                    events: null,
                    actions: null,
                },
            }
            expect(doesSurveyUrlMatch(nonMatchingSurvey, host)).toBe(false)
        })

        it('should match using is_not match type', () => {
            mockTargetingUrl('https://example.com')

            const survey = {
                conditions: {
                    cancelEvents: null,
                    url: 'https://other.com',
                    urlMatchType: 'is_not' as const,
                    events: null,
                    actions: null,
                },
            }
            expect(doesSurveyUrlMatch(survey, host)).toBe(true)

            const nonMatchingSurvey = {
                conditions: {
                    cancelEvents: null,
                    url: 'https://example.com',
                    urlMatchType: 'is_not' as const,
                    events: null,
                    actions: null,
                },
            }
            expect(doesSurveyUrlMatch(nonMatchingSurvey, host)).toBe(false)
        })
    })
})

describe('addSurveyCSSVariablesToElement', () => {
    let element: HTMLElement

    beforeEach(() => {
        element = document.createElement('div')
    })

    describe('input background color', () => {
        it('should use inputBackground, falling back to deprecated inputBackgroundColor', () => {
            // inputBackground (core field) takes precedence
            addSurveyCSSVariablesToElement(element, SurveyType.Popover, {
                inputBackground: '#111111',
                inputBackgroundColor: '#999999',
            })
            expect(element.style.getPropertyValue('--ph-survey-input-background')).toBe('#111111')

            // Falls back to deprecated inputBackgroundColor for backwards compat
            element = document.createElement('div')
            addSurveyCSSVariablesToElement(element, SurveyType.Popover, {
                inputBackgroundColor: '#ff0000',
            })
            expect(element.style.getPropertyValue('--ph-survey-input-background')).toBe('#ff0000')
        })

        it('should auto-adjust to #f8f8f8 when main backgroundColor is white and no explicit input background', () => {
            addSurveyCSSVariablesToElement(element, SurveyType.Popover, { backgroundColor: 'white' })
            expect(element.style.getPropertyValue('--ph-survey-input-background')).toBe('#f8f8f8')

            // But not when explicit input background is provided
            element = document.createElement('div')
            addSurveyCSSVariablesToElement(element, SurveyType.Popover, {
                backgroundColor: 'white',
                inputBackground: '#123456',
            })
            expect(element.style.getPropertyValue('--ph-survey-input-background')).toBe('#123456')
        })
    })

    describe('text colors', () => {
        it('should use textColor override for primary text, with auto-contrast fallback', () => {
            // Override works
            addSurveyCSSVariablesToElement(element, SurveyType.Popover, { textColor: '#ff0000' })
            expect(element.style.getPropertyValue('--ph-survey-text-primary-color')).toBe('#ff0000')

            // Auto-contrast fallback (dark text on light bg)
            element = document.createElement('div')
            addSurveyCSSVariablesToElement(element, SurveyType.Popover, { backgroundColor: '#ffffff' })
            expect(element.style.getPropertyValue('--ph-survey-text-primary-color')).toBe('#020617')
        })

        it('should use inputTextColor for both text inputs AND rating buttons', () => {
            addSurveyCSSVariablesToElement(element, SurveyType.Popover, { inputTextColor: '#00ff00' })

            expect(element.style.getPropertyValue('--ph-survey-input-text-color')).toBe('#00ff00')
            expect(element.style.getPropertyValue('--ph-survey-rating-text-color')).toBe('#00ff00')
        })

        it('should auto-calculate input/rating text color from background when no override', () => {
            // Light background → dark text
            addSurveyCSSVariablesToElement(element, SurveyType.Popover, { inputBackground: '#ffffff' })
            expect(element.style.getPropertyValue('--ph-survey-input-text-color')).toBe('#020617')
            expect(element.style.getPropertyValue('--ph-survey-rating-text-color')).toBe('#020617')

            // Dark background → light text
            element = document.createElement('div')
            addSurveyCSSVariablesToElement(element, SurveyType.Popover, { inputBackground: '#000000' })
            expect(element.style.getPropertyValue('--ph-survey-input-text-color')).toBe('white')
            expect(element.style.getPropertyValue('--ph-survey-rating-text-color')).toBe('white')
        })

        it('should always auto-calculate active rating text (ignores inputTextColor)', () => {
            addSurveyCSSVariablesToElement(element, SurveyType.Popover, {
                ratingButtonActiveColor: '#ffffff', // light bg → should get dark text
                inputTextColor: '#ff0000', // should NOT affect active rating
            })

            // Active rating auto-calculates from its background
            expect(element.style.getPropertyValue('--ph-survey-rating-active-text-color')).toBe('#020617')
            // Inactive rating uses inputTextColor
            expect(element.style.getPropertyValue('--ph-survey-rating-text-color')).toBe('#ff0000')
        })
    })
})

describe('sendSurveyEvent', () => {
    const baseSurvey: Survey = {
        id: 'test-survey-id',
        name: 'Test Survey',
        description: 'Test Description',
        type: SurveyType.Popover,
        questions: [{ type: 'open', question: 'What do you think?', id: 'q1' }],
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

    beforeEach(() => {
        localStorage.clear()
    })

    it('leaves the draft and completion state untouched when capturing is opted out', () => {
        const mockCapture = vi.fn()
        const dispatch = vi.spyOn(window, 'dispatchEvent')
        localStorage.setItem(
            `${SURVEY_IN_PROGRESS_PREFIX}${baseSurvey.id}`,
            JSON.stringify({ responses: { $survey_response_q1: 'Great!' } })
        )
        const before = { ...localStorage }
        const critical = vi.spyOn(SURVEY_LOGGER, 'critical').mockImplementation(() => {})
        const host = createSurveyRenderContext({ capture: mockCapture, reloadFlags: vi.fn(), canCapture: false })

        sendSurveyEvent({
            responses: { $survey_response_q1: 'Great!' },
            survey: baseSurvey,
            surveySubmissionId: 'submission-123',
            isSurveyCompleted: true,
            posthog: host,
        })

        expect(mockCapture).not.toHaveBeenCalled()
        expect(host.reloadFlags).not.toHaveBeenCalled()
        expect(dispatch).not.toHaveBeenCalled()
        expect({ ...localStorage }).toEqual(before)
        expect(critical).not.toHaveBeenCalled()
        dispatch.mockRestore()
        critical.mockRestore()
    })

    it('still captures a response when persisting seen state fails', () => {
        const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota')
        })
        const host = createSurveyRenderContext({ capture: vi.fn(), reloadFlags: vi.fn(), canCapture: true })
        try {
            expect(() =>
                sendSurveyEvent({
                    responses: { $survey_response_q1: 'Great!' },
                    survey: baseSurvey,
                    surveySubmissionId: 'submission-123',
                    isSurveyCompleted: true,
                    posthog: host,
                })
            ).not.toThrow()
            expect(host.capture).toHaveBeenCalledWith(
                'survey sent',
                expect.objectContaining({ $survey_response_q1: 'Great!' })
            )
        } finally {
            write.mockRestore()
        }
    })

    it('stays silent while capturing is on', () => {
        const critical = vi.spyOn(SURVEY_LOGGER, 'critical').mockImplementation(() => {})
        const host = createSurveyRenderContext({ capture: vi.fn(), reloadFlags: vi.fn(), canCapture: true })

        sendSurveyEvent({
            responses: { $survey_response_q1: 'Great!' },
            survey: baseSurvey,
            surveySubmissionId: 'submission-123',
            isSurveyCompleted: true,
            posthog: host,
        })

        expect(critical).not.toHaveBeenCalled()
        critical.mockRestore()
    })

    it('includes custom properties in captured event', () => {
        const mockCapture = vi.fn()
        const host = createSurveyRenderContext({ capture: mockCapture, reloadFlags: vi.fn(), canCapture: true })

        sendSurveyEvent({
            responses: { $survey_response_q1: 'Great!' },
            survey: baseSurvey,
            surveySubmissionId: 'submission-123',
            isSurveyCompleted: true,
            posthog: host,
            properties: {
                $ai_generation_id: 'gen-456',
                $ai_trace_id: 'trace-789',
                custom_field: 'custom_value',
                $survey_name: 'Custom survey name',
                $set: { custom_person_property: true },
            },
        })

        expect(mockCapture).toHaveBeenCalledTimes(1)
        const capturedEvent = mockCapture.mock.calls[0]
        expect(capturedEvent[0]).toBe('survey sent')

        const eventProperties = capturedEvent[1]
        expect(eventProperties.$ai_generation_id).toBe('gen-456')
        expect(eventProperties.$ai_trace_id).toBe('trace-789')
        expect(eventProperties.custom_field).toBe('custom_value')
        expect(eventProperties.$survey_name).toBe('Custom survey name')
        expect(eventProperties.$set).toEqual({ '$survey_responded/test-survey-id': true })
    })

    it('works without custom properties', () => {
        const mockCapture = vi.fn()
        const host = createSurveyRenderContext({ capture: mockCapture, reloadFlags: vi.fn(), canCapture: true })

        sendSurveyEvent({
            responses: { $survey_response_q1: 'Great!' },
            survey: baseSurvey,
            surveySubmissionId: 'submission-123',
            isSurveyCompleted: true,
            posthog: host,
        })

        expect(mockCapture).toHaveBeenCalledTimes(1)
        const eventProperties = mockCapture.mock.calls[0][1]
        expect(eventProperties.$survey_id).toBe('test-survey-id')
        expect(eventProperties.$ai_generation_id).toBeUndefined()
    })

    it.each([false, true])(
        'emits completion=%s and only clears progress and reloads flags on completion',
        (completed) => {
            const host = createSurveyRenderContext({
                capture: vi.fn(),
                reloadFlags: vi.fn(),
                canCapture: true,
            })
            Object.assign(host.config, { uiHost: 'https://us.posthog.com' })
            const progress = {
                surveySubmissionId: 'submission-123',
                lastQuestionIndex: 0,
                responses: { $survey_response_q1: 'Great!' },
                surveyLanguage: 'fr',
                questionSnapshots: { q1: 'Votre avis ?' },
            }
            setInProgressSurveyState(baseSurvey, progress)

            sendSurveyEvent({
                ...progress,
                survey: baseSurvey,
                isSurveyCompleted: completed,
                posthog: host,
            })

            expect(host.capture).toHaveBeenCalledWith('survey sent', {
                $survey_id: baseSurvey.id,
                $survey_name: baseSurvey.name,
                $survey_iteration: null,
                $survey_iteration_start_date: null,
                $survey_submission_id: 'submission-123',
                $survey_completed: completed,
                $survey_language: 'fr',
                $survey_response_q1: 'Great!',
                $survey_questions: [{ id: 'q1', question: 'Votre avis ?', response: 'Great!' }],
                sessionRecordingUrl: `https://us.posthog.com/project/${host.client!.projectToken}/replay/${host.client!.session.sessionId}`,
                $set: { '$survey_responded/test-survey-id': true },
            })
            expect(getInProgressSurveyState(baseSurvey)).toEqual(completed ? null : progress)
            expect(host.reloadFlags).toHaveBeenCalledTimes(completed ? 1 : 0)
        }
    )
})
