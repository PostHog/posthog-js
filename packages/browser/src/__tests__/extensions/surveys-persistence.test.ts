import { PostHogPersistence } from '../../posthog-persistence'
import { PostHogConfig } from '../../types'
import { setSurveySeenOnLocalStorage } from '../../utils/survey-utils'
import {
    getSurveySeen,
    hasWaitPeriodPassed,
    setInProgressSurveyState,
    getInProgressSurveyState,
    clearInProgressSurveyState,
} from '../../extensions/surveys/surveys-extension-utils'
import { Survey, SurveyType, SurveySchedule } from '../../posthog-surveys-types'
import { PostHog } from '../../posthog-core'

describe('Surveys Persistence Migration - Simple Test', () => {
    let instance: any

    const config = {
        token: 'test-token',
        persistence: 'memory',
        api_host: 'https://app.posthog.com',
    } as PostHogConfig

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

    beforeEach(() => {
        localStorage.clear()

        instance = {
            config: { ...config },
            persistence: new PostHogPersistence(config),
        }
    })

    describe('Core functionality - new logic works', () => {
        it('should use persistence API when PostHog instance is provided', () => {
            setSurveySeenOnLocalStorage(baseSurvey, instance)

            expect(instance.persistence.get_property('seenSurvey_test-survey')).toBe(true)
        })

        it('should read survey seen status from persistence API', () => {
            instance.persistence.set_property('seenSurvey_test-survey', true)

            const result = getSurveySeen(baseSurvey, instance)

            expect(result).toBe(true)
        })

        it('should store and retrieve survey progress state via persistence API', () => {
            const progressState = {
                surveySubmissionId: 'test-123',
                lastQuestionIndex: 2,
                responses: { $survey_response_q1: 'answer1' },
            }

            setInProgressSurveyState(baseSurvey, progressState, instance)
            const retrieved = getInProgressSurveyState(baseSurvey, instance)

            expect(retrieved).toEqual(progressState)
        })
    })

    describe('Backwards compatibility - localStorage fallback works', () => {
        it('should fallback to localStorage when no PostHog instance provided', () => {
            setSurveySeenOnLocalStorage(baseSurvey)

            expect(localStorage.getItem('seenSurvey_test-survey')).toBe('true')
        })

        it('should read from localStorage when no PostHog instance provided', () => {
            localStorage.setItem('seenSurvey_test-survey', 'true')

            const result = getSurveySeen(baseSurvey)

            expect(result).toBe(true)
        })

        it('should fallback to localStorage when persistence is disabled', () => {
            const disabledInstance = {
                config: { ...config, disable_persistence: true },
                persistence: new PostHogPersistence({ ...config, disable_persistence: true }),
            }

            setSurveySeenOnLocalStorage(baseSurvey, disabledInstance as PostHog)

            // Should use localStorage fallback
            expect(localStorage.getItem('seenSurvey_test-survey')).toBe('true')
            // When persistence is disabled, it should take localStorage path
            expect(disabledInstance.persistence.isDisabled()).toBe(true)
        })
    })

    describe('Regression protection - existing behavior preserved', () => {
        it('should handle survey iterations correctly in persistence', () => {
            const surveyWithIteration = { ...baseSurvey, current_iteration: 2 }

            setSurveySeenOnLocalStorage(surveyWithIteration, instance)

            expect(instance.persistence.get_property('seenSurvey_test-survey_2')).toBe(true)
            expect(instance.persistence.get_property('seenSurvey_test-survey')).toBeUndefined()
        })

        it('should respect SurveySchedule.Always for repeatable surveys', () => {
            const repeatableSurvey = { ...baseSurvey, schedule: SurveySchedule.Always }
            instance.persistence.set_property('seenSurvey_test-survey', true)

            const result = getSurveySeen(repeatableSurvey, instance)

            expect(result).toBe(false) // Should allow repeated activation
        })

        it('should clear survey progress state completely', () => {
            const progressState = { surveySubmissionId: 'test-123', lastQuestionIndex: 1, responses: {} }
            setInProgressSurveyState(baseSurvey, progressState, instance)

            clearInProgressSurveyState(baseSurvey, instance)

            expect(getInProgressSurveyState(baseSurvey, instance)).toBeNull()
        })

        it('should handle wait period logic with date parsing', () => {
            // Mock current date
            const originalDate = global.Date
            const mockCurrentDate = new originalDate('2025-01-15T12:00:00Z')

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

            try {
                instance.persistence.set_property('lastSeenSurveyDate', '2025-01-01T12:00:00Z') // 14 days ago

                const result = hasWaitPeriodPassed(7, instance) // 7 day wait period

                expect(result).toBe(true)
            } finally {
                global.Date = originalDate
            }
        })
    })
})
