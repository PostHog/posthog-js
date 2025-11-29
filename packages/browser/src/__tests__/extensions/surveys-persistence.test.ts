import { PostHogPersistence } from '../../posthog-persistence'
import { PostHogConfig } from '../../types'
import { setSurveySeenOnLocalStorage } from '../../utils/survey-utils'
import {
    getSurveySeen,
    setInProgressSurveyState,
    getInProgressSurveyState,
    clearInProgressSurveyState,
} from '../../extensions/surveys/surveys-extension-utils'
import { Survey, SurveyType, SurveySchedule } from '../../posthog-surveys-types'

describe('Surveys Persistence Migration', () => {
    let instance: any

    const config = {
        token: 'test-token',
        persistence: 'localStorage+cookie',
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

    describe('Core persistence functionality', () => {
        it('should write and read via persistence API', () => {
            setSurveySeenOnLocalStorage(baseSurvey, instance)

            expect(instance.persistence.get_property('seenSurvey_test-survey')).toBe(true)
            expect(getSurveySeen(baseSurvey, instance)).toBe(true)
        })

        it('should handle complex JSON state', () => {
            const state = {
                surveySubmissionId: 'test-123',
                lastQuestionIndex: 2,
                responses: { $survey_response_q1: 'answer1' },
            }

            setInProgressSurveyState(baseSurvey, state, instance)
            const retrieved = getInProgressSurveyState(baseSurvey, instance)

            expect(retrieved).toEqual(state)
        })

        it('should clear state completely', () => {
            const state = { surveySubmissionId: 'test-123', lastQuestionIndex: 1, responses: {} }
            setInProgressSurveyState(baseSurvey, state, instance)

            clearInProgressSurveyState(baseSurvey, instance)

            expect(getInProgressSurveyState(baseSurvey, instance)).toBeNull()
        })
    })

    describe('Backwards compatibility', () => {
        it('should fallback to localStorage when no posthog instance', () => {
            setSurveySeenOnLocalStorage(baseSurvey)

            expect(localStorage.getItem('seenSurvey_test-survey')).toBe('true')
            expect(getSurveySeen(baseSurvey)).toBe(true)
        })

        it('should fallback to localStorage when persistence disabled', () => {
            const disabledInstance: any = {
                config: { ...config, disable_persistence: true },
                persistence: new PostHogPersistence({ ...config, disable_persistence: true }),
            }

            setSurveySeenOnLocalStorage(baseSurvey, disabledInstance)

            expect(localStorage.getItem('seenSurvey_test-survey')).toBe('true')
            expect(disabledInstance.persistence.isDisabled()).toBe(true)
        })

        it('should not require persistence.isDisabled to exist', () => {
            const legacyInstance: any = {
                config: { ...config },
                persistence: new PostHogPersistence(config),
            }
            delete legacyInstance.persistence.isDisabled

            expect(() => setSurveySeenOnLocalStorage(baseSurvey, legacyInstance)).not.toThrow()
            expect(legacyInstance.persistence.get_property('seenSurvey_test-survey')).toBe(true)
        })
    })

    describe('Migration from localStorage to persistence', () => {
        it('should read old localStorage data when not yet in persistence', () => {
            // CRITICAL: User has old data, new code deployed
            localStorage.setItem('seenSurvey_test-survey', 'true')

            const result = getSurveySeen(baseSurvey, instance)

            expect(result).toBe(true) // Reads from localStorage
            expect(instance.persistence.get_property('seenSurvey_test-survey')).toBeUndefined() // Not migrated yet
        })

        it('should prefer persistence over localStorage when both exist', () => {
            // Edge case: Both sources have data
            localStorage.setItem('seenSurvey_test-survey', 'false') // Stale
            instance.persistence.set_property('seenSurvey_test-survey', true) // Current

            const result = getSurveySeen(baseSurvey, instance)

            expect(result).toBe(true) // Uses persistence
        })

        it('should read complex JSON state from localStorage without migrating yet', () => {
            // Lazy migration: reads work, but data doesn't migrate until written
            const state = {
                surveySubmissionId: 'test-123',
                lastQuestionIndex: 2,
                responses: { $survey_response_q1: 'answer1' },
            }
            localStorage.setItem('inProgressSurvey_test-survey', JSON.stringify(state))

            const retrieved = getInProgressSurveyState(baseSurvey, instance)

            expect(retrieved).toEqual(state) // Read succeeds
            expect(instance.persistence.get_property('inProgressSurvey_test-survey')).toBeUndefined() // Not migrated yet
        })
    })

    describe('Regression protection', () => {
        it('should handle survey iterations with correct keys', () => {
            const surveyWithIteration = { ...baseSurvey, current_iteration: 2 }

            setSurveySeenOnLocalStorage(surveyWithIteration, instance)

            expect(instance.persistence.get_property('seenSurvey_test-survey_2')).toBe(true)
            expect(instance.persistence.get_property('seenSurvey_test-survey')).toBeUndefined()
        })

        it('should respect repeatable survey behavior', () => {
            const repeatableSurvey = { ...baseSurvey, schedule: SurveySchedule.Always }
            instance.persistence.set_property('seenSurvey_test-survey', true)

            const result = getSurveySeen(repeatableSurvey, instance)

            expect(result).toBe(false) // Allows repeat activation
        })
    })

    describe('Storage isolation', () => {
        it('should use namespaced keys to avoid conflicts', () => {
            // Documents that persistence and direct localStorage are isolated
            instance.persistence.set_property('seenSurvey_test-survey', true)

            // Direct localStorage doesn't see it (different key structure)
            expect(localStorage.getItem('seenSurvey_test-survey')).toBeNull()

            // Persistence uses namespaced key
            expect(localStorage.getItem('ph_test-token_posthog')).toBeTruthy()
        })
    })
})
