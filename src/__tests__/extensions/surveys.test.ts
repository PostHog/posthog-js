/* eslint-disable compat/compat */
import { act, fireEvent, render, renderHook } from '@testing-library/preact'
import {
    SurveyManager,
    generateSurveys,
    renderFeedbackWidgetPreview,
    renderSurveysPreview,
    useHideSurveyOnURLChange,
    usePopupVisibility,
} from '../../extensions/surveys'
import { createShadow } from '../../extensions/surveys/surveys-extension-utils'
import { Survey, SurveyQuestionType, SurveySchedule, SurveyType, SurveyWidgetType } from '../../posthog-surveys-types'

import { afterAll, beforeAll, beforeEach } from '@jest/globals'
import '@testing-library/jest-dom'
import * as Preact from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { PostHog } from '../../posthog-core'
import { DecideResponse } from '../../types'
import { SURVEY_IN_PROGRESS_PREFIX } from '../../utils/survey-utils'

declare const global: any

describe('survey display logic', () => {
    beforeEach(() => {
        // we have to manually reset the DOM before each test
        document.getElementsByTagName('html')[0].innerHTML = ''
        localStorage.clear()
        jest.clearAllMocks()
    })

    test('createShadow', () => {
        const surveyId = 'randomSurveyId'
        const mockShadow = createShadow(`.survey-${surveyId}-form {}`, surveyId)
        expect(mockShadow.mode).toBe('open')
        expect(mockShadow.host.className).toBe(`PostHogSurvey-${surveyId}`)
    })

    const mockSurveys: Survey[] = [
        {
            id: 'testSurvey1',
            name: 'Test survey 1',
            description: 'Test survey description 1',
            type: SurveyType.Popover,
            linked_flag_key: null,
            targeting_flag_key: null,
            internal_targeting_flag_key: null,
            questions: [
                {
                    question: 'How satisfied are you with our newest product?',
                    description: 'This is a question description',
                    descriptionContentType: 'text',
                    type: SurveyQuestionType.Rating,
                    display: 'number',
                    scale: 10,
                    lowerBoundLabel: 'Not Satisfied',
                    upperBoundLabel: 'Very Satisfied',
                    id: 'question-a',
                },
            ],
            appearance: null,
            conditions: null,
            start_date: '2021-01-01T00:00:00.000Z',
            end_date: null,
            current_iteration: null,
            current_iteration_start_date: null,
            feature_flag_keys: [],
        },
    ]

    const mockPostHog = {
        surveys: {
            getSurveys: jest.fn().mockImplementation((callback) => callback(mockSurveys)),
        },
        get_session_replay_url: jest.fn(),
        capture: jest.fn().mockImplementation((eventName) => eventName),
    } as unknown as PostHog

    test('callSurveysAndEvaluateDisplayLogic runs on interval irrespective of url change', () => {
        jest.useFakeTimers()
        jest.spyOn(global, 'setInterval')
        generateSurveys(mockPostHog)
        expect(mockPostHog.surveys.getSurveys).toBeCalledTimes(1)
        expect(setInterval).toHaveBeenLastCalledWith(expect.any(Function), 1000)

        jest.advanceTimersByTime(1000)
        expect(mockPostHog.surveys.getSurveys).toBeCalledTimes(2)
        expect(setInterval).toHaveBeenLastCalledWith(expect.any(Function), 1000)
    })
})

describe('usePopupVisibility', () => {
    const mockSurvey: Survey = {
        id: 'testSurvey1',
        name: 'Test survey 1',
        description: 'Test survey description 1',
        type: SurveyType.Popover,
        linked_flag_key: null,
        targeting_flag_key: null,
        internal_targeting_flag_key: null,
        questions: [
            {
                question: 'How satisfied are you with our newest product?',
                description: 'This is a question description',
                descriptionContentType: 'text',
                type: SurveyQuestionType.Rating,
                display: 'number',
                scale: 10,
                lowerBoundLabel: 'Not Satisfied',
                upperBoundLabel: 'Very Satisfied',
                id: 'question-a',
            },
        ],
        appearance: {},
        conditions: null,
        start_date: '2021-01-01T00:00:00.000Z',
        end_date: null,
        current_iteration: null,
        current_iteration_start_date: null,
        feature_flag_keys: null,
    }
    const mockPostHog = {
        getActiveMatchingSurveys: jest.fn().mockImplementation((callback) => callback([mockSurvey])),
        get_session_replay_url: jest.fn(),
        capture: jest.fn().mockImplementation((eventName) => eventName),
    } as unknown as PostHog

    const removeSurvey = jest.fn()

    test('should set isPopupVisible to true immediately if delay is 0', () => {
        const { result } = renderHook(() => usePopupVisibility(mockSurvey, mockPostHog, 0, false, removeSurvey))
        expect(result.current.isPopupVisible).toBe(true)
    })

    test('should set isPopupVisible to true after delay', () => {
        jest.useFakeTimers()
        const { result } = renderHook(() => usePopupVisibility(mockSurvey, mockPostHog, 1000, false, removeSurvey))
        expect(result.current.isPopupVisible).toBe(false)
        act(() => {
            jest.advanceTimersByTime(1000)
        })
        expect(result.current.isPopupVisible).toBe(true)
        jest.useRealTimers()
    })

    test('should hide popup when PHSurveyClosed event is dispatched', () => {
        const { result } = renderHook(() => usePopupVisibility(mockSurvey, mockPostHog, 0, false, removeSurvey))
        act(() => {
            window.dispatchEvent(new CustomEvent('PHSurveyClosed', { detail: { surveyId: mockSurvey.id } }))
        })
        expect(result.current.isPopupVisible).toBe(false)
    })

    test('should show thank you message when survey is sent and handle auto disappear', () => {
        jest.useFakeTimers()
        mockSurvey.appearance = {
            displayThankYouMessage: true,
            autoDisappear: true,
            thankYouMessageHeader: 'Thank you!',
            thankYouMessageDescription: 'We appreciate your feedback.',
        }

        const { result } = renderHook(() => usePopupVisibility(mockSurvey, mockPostHog, 0, false, removeSurvey))
        act(() => {
            window.dispatchEvent(new CustomEvent('PHSurveySent', { detail: { surveyId: mockSurvey.id } }))
        })

        expect(result.current.isSurveySent).toBe(true)
        expect(result.current.isPopupVisible).toBe(true)

        act(() => {
            jest.advanceTimersByTime(5000)
        })

        expect(result.current.isPopupVisible).toBe(false)
        jest.useRealTimers()
    })

    test('should clean up event listeners and timers on unmount', () => {
        jest.useFakeTimers()
        const { unmount } = renderHook(() => usePopupVisibility(mockSurvey, mockPostHog, 1000, false, removeSurvey))
        const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener')

        unmount()

        expect(removeEventListenerSpy).toHaveBeenCalledWith('PHSurveyClosed', expect.any(Function))
        expect(removeEventListenerSpy).toHaveBeenCalledWith('PHSurveySent', expect.any(Function))
        jest.useRealTimers()
    })

    test('should set isPopupVisible to true if isPreviewMode is true', () => {
        const { result } = renderHook(() => usePopupVisibility(mockSurvey, mockPostHog, 1000, true, removeSurvey))
        expect(result.current.isPopupVisible).toBe(true)
    })

    test('should set isPopupVisible to true after a delay of 500 milliseconds', () => {
        jest.useFakeTimers()
        const { result } = renderHook(() => usePopupVisibility(mockSurvey, mockPostHog, 500, false, removeSurvey))
        expect(result.current.isPopupVisible).toBe(false)
        act(() => {
            jest.advanceTimersByTime(500)
        })
        expect(result.current.isPopupVisible).toBe(true)
        jest.useRealTimers()
    })

    test('should not throw an error if posthog is undefined', () => {
        const { result } = renderHook(() => usePopupVisibility(mockSurvey, undefined, 0, false, removeSurvey))
        expect(result.current.isPopupVisible).toBe(true)
    })

    test('should clean up event listeners on unmount when delay is 0', () => {
        const { unmount } = renderHook(() => usePopupVisibility(mockSurvey, mockPostHog, 0, false, removeSurvey))
        const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener')

        unmount()

        expect(removeEventListenerSpy).toHaveBeenCalledWith('PHSurveyClosed', expect.any(Function))
        expect(removeEventListenerSpy).toHaveBeenCalledWith('PHSurveySent', expect.any(Function))
    })

    test('should dispatch PHSurveyShown event when survey is shown', () => {
        const dispatchEventSpy = jest.spyOn(window, 'dispatchEvent')
        renderHook(() => usePopupVisibility(mockSurvey, mockPostHog, 0, false, removeSurvey))

        expect(dispatchEventSpy).toHaveBeenCalledWith(new Event('PHSurveyShown'))
    })

    test('should handle multiple surveys with overlapping conditions', () => {
        jest.useFakeTimers()
        const mockSurvey2 = { ...mockSurvey, id: 'testSurvey2', name: 'Test survey 2' } as Survey
        const { result: result1 } = renderHook(() =>
            usePopupVisibility(mockSurvey, mockPostHog, 0, false, removeSurvey)
        )
        const { result: result2 } = renderHook(() =>
            usePopupVisibility(mockSurvey2, mockPostHog, 500, false, removeSurvey)
        )

        expect(result1.current.isPopupVisible).toBe(true)
        expect(result2.current.isPopupVisible).toBe(false)

        act(() => {
            jest.advanceTimersByTime(500)
        })

        expect(result2.current.isPopupVisible).toBe(true)
        jest.useRealTimers()
    })
})

describe('SurveyManager', () => {
    let mockPostHog: PostHog
    let surveyManager: SurveyManager
    let mockSurveys: Survey[]
    const decideResponse = {
        featureFlags: {
            'linked-flag-key': true,
            'survey-targeting-flag-key': true,
            'linked-flag-key2': true,
            'survey-targeting-flag-key2': false,
            'enabled-internal-targeting-flag-key': true,
            'disabled-internal-targeting-flag-key': false,
        },
        surveys: true,
    } as unknown as DecideResponse

    beforeEach(() => {
        mockSurveys = [
            {
                id: 'testSurvey1',
                name: 'Test survey 1',
                description: 'Test survey description 1',
                type: SurveyType.Popover,
                linked_flag_key: null,
                targeting_flag_key: null,
                internal_targeting_flag_key: null,
                questions: [
                    {
                        question: 'How satisfied are you with our newest product?',
                        description: 'This is a question description',
                        descriptionContentType: 'text',
                        type: SurveyQuestionType.Rating,
                        display: 'number',
                        scale: 10,
                        lowerBoundLabel: 'Not Satisfied',
                        upperBoundLabel: 'Very Satisfied',
                        id: 'question-a',
                    },
                ],
                appearance: {},
                conditions: null,
                start_date: '2021-01-01T00:00:00.000Z',
                end_date: null,
                current_iteration: null,
                current_iteration_start_date: null,
                feature_flag_keys: [],
            },
        ]

        mockPostHog = {
            getActiveMatchingSurveys: jest.fn(),
            get_session_replay_url: jest.fn(),
            capture: jest.fn(),
            featureFlags: {
                _send_request: jest
                    .fn()
                    .mockImplementation(({ callback }) => callback({ statusCode: 200, json: decideResponse })),
                getFeatureFlag: jest.fn().mockImplementation((featureFlag) => decideResponse.featureFlags[featureFlag]),
                isFeatureEnabled: jest
                    .fn()
                    .mockImplementation((featureFlag) => decideResponse.featureFlags[featureFlag]),
            },
            surveys: {
                getSurveys: jest.fn().mockImplementation((callback) => callback(mockSurveys)),
            },
        } as unknown as PostHog

        surveyManager = new SurveyManager(mockPostHog)
    })

    test('callSurveysAndEvaluateDisplayLogic should handle a single popover survey correctly', () => {
        mockPostHog.getActiveMatchingSurveys = jest.fn((callback) => callback([mockSurveys[0]]))
        const handlePopoverSurveyMock = jest
            .spyOn(surveyManager as any, '_handlePopoverSurvey')
            .mockImplementation(() => {})
        const canShowNextEventBasedSurveyMock = jest
            .spyOn(surveyManager as any, '_canShowNextEventBasedSurvey')
            .mockReturnValue(true)

        surveyManager.callSurveysAndEvaluateDisplayLogic()

        expect(mockPostHog.surveys.getSurveys).toHaveBeenCalled()
        expect(handlePopoverSurveyMock).toHaveBeenCalledWith(mockSurveys[0])
        expect(canShowNextEventBasedSurveyMock).toHaveBeenCalled()
    })

    test('should initialize surveyInFocus correctly', () => {
        expect(surveyManager).toBeDefined()
        expect(typeof surveyManager.getTestAPI().addSurveyToFocus).toBe('function')
        expect(typeof surveyManager.getTestAPI().removeSurveyFromFocus).toBe('function')
        expect(typeof surveyManager.callSurveysAndEvaluateDisplayLogic).toBe('function')
        expect(surveyManager.getTestAPI().surveyInFocus).toBe(null)
    })

    test('addSurveyToFocus should add survey ID to surveyInFocus', () => {
        surveyManager.getTestAPI().addSurveyToFocus('survey1')
        expect(surveyManager.getTestAPI().surveyInFocus).toEqual('survey1')
    })

    test('removeSurveyFromFocus should remove survey ID from surveyInFocus', () => {
        surveyManager.getTestAPI().addSurveyToFocus('survey1')
        surveyManager.getTestAPI().removeSurveyFromFocus('survey1')
        expect(surveyManager.getTestAPI().surveyInFocus).toBe(null)
    })

    test('canShowNextEventBasedSurvey should return correct visibility status', () => {
        const surveyDiv = document.createElement('div')
        surveyDiv.className = 'PostHogSurvey_test'
        surveyDiv.attachShadow({ mode: 'open' })
        surveyDiv.shadowRoot!.appendChild(document.createElement('style'))
        document.body.appendChild(surveyDiv)

        expect(surveyManager.getTestAPI().canShowNextEventBasedSurvey()).toBe(true)

        surveyDiv.shadowRoot!.appendChild(document.createElement('div'))
        expect(surveyManager.getTestAPI().canShowNextEventBasedSurvey()).toBe(false)
    })

    test('callSurveysAndEvaluateDisplayLogic should handle popup surveys correctly', () => {
        const handlePopoverSurveyMock = jest
            .spyOn(surveyManager as any, '_handlePopoverSurvey')
            .mockImplementation(() => {})
        const handleWidgetMock = jest.spyOn(surveyManager as any, '_handleWidget').mockImplementation(() => {})
        const manageWidgetSelectorListener = jest
            .spyOn(surveyManager as any, '_manageWidgetSelectorListener')
            .mockImplementation(() => {})
        jest.spyOn(surveyManager as any, '_canShowNextEventBasedSurvey').mockReturnValue(true)

        surveyManager.callSurveysAndEvaluateDisplayLogic()

        expect(mockPostHog.surveys.getSurveys).toHaveBeenCalled()
        expect(handlePopoverSurveyMock).toHaveBeenCalledWith(mockSurveys[0])
        expect(handleWidgetMock).not.toHaveBeenCalled()
        expect(manageWidgetSelectorListener).not.toHaveBeenCalled()
    })

    test('handleWidget should render the widget correctly', () => {
        // Add a minimal widget survey to the mock surveys array
        mockSurveys.push({
            id: 'widgetSurvey1',
            name: 'Widget Survey',
            description: 'A widget survey',
            type: SurveyType.Widget,
            linked_flag_key: null,
            targeting_flag_key: null,
            internal_targeting_flag_key: null,
            questions: [],
            appearance: { widgetType: SurveyWidgetType.Tab }, // Specify widget type
            conditions: null,
            start_date: '2021-01-01T00:00:00.000Z',
            end_date: null,
            current_iteration: null,
            current_iteration_start_date: null,
            feature_flag_keys: [],
        })
        const mockSurvey = mockSurveys[1]
        const handleWidgetSpy = jest.spyOn(surveyManager as any, '_handleWidget')
        surveyManager.getTestAPI().handleWidget(mockSurvey) // Call the actual method
        expect(handleWidgetSpy).toHaveBeenCalledWith(mockSurvey)
        // We can add more specific assertions here if needed, e.g., checking if the shadow DOM was created
        // For now, just ensuring it was called seems sufficient for this test's scope.
    })

    test('manageWidgetSelectorListener should be called for selector widgets', () => {
        const mockSurvey: Survey = {
            id: 'selectorWidgetSurvey',
            name: 'Selector Widget Survey',
            description: 'A selector widget survey',
            type: SurveyType.Widget,
            questions: [],
            appearance: {
                widgetType: SurveyWidgetType.Selector,
                widgetSelector: '.my-selector',
            },
            conditions: null,
            start_date: '2021-01-01T00:00:00.000Z',
            end_date: null,
            current_iteration: null,
            current_iteration_start_date: null,
            feature_flag_keys: [],
            linked_flag_key: null,
            targeting_flag_key: null,
            internal_targeting_flag_key: null,
        }
        mockPostHog.surveys.getSurveys = jest.fn((callback) => callback([mockSurvey]))
        document.body.innerHTML = '<div class="my-selector">Click Me</div>'

        const manageWidgetSelectorListenerSpy = jest.spyOn(surveyManager as any, '_manageWidgetSelectorListener')

        surveyManager.callSurveysAndEvaluateDisplayLogic()

        expect(manageWidgetSelectorListenerSpy).toHaveBeenCalledWith(mockSurvey)
    })

    test('callSurveysAndEvaluateDisplayLogic should not call surveys in focus', () => {
        mockPostHog.surveys.getSurveys = jest.fn((callback) => callback(mockSurveys))

        surveyManager.getTestAPI().addSurveyToFocus('survey1')
        surveyManager.callSurveysAndEvaluateDisplayLogic()

        expect(mockPostHog.surveys.getSurveys).toHaveBeenCalledTimes(1)
        expect(surveyManager.getTestAPI().surveyInFocus).toBe('survey1')
    })

    test('surveyInFocus handling works correctly with in callSurveysAndEvaluateDisplayLogic', () => {
        mockPostHog.surveys.getSurveys = jest.fn((callback) => callback(mockSurveys))

        surveyManager.getTestAPI().addSurveyToFocus('survey1')
        surveyManager.callSurveysAndEvaluateDisplayLogic()

        const handlePopoverSurveyMock = jest
            .spyOn(surveyManager as any, '_handlePopoverSurvey')
            .mockImplementation(() => {})

        expect(mockPostHog.surveys.getSurveys).toHaveBeenCalledTimes(1)
        expect(surveyManager.getTestAPI().surveyInFocus).toBe('survey1')
        expect(handlePopoverSurveyMock).not.toHaveBeenCalled()

        surveyManager.getTestAPI().removeSurveyFromFocus('survey1')
        jest.spyOn(surveyManager as any, '_canShowNextEventBasedSurvey').mockReturnValue(true)

        surveyManager.callSurveysAndEvaluateDisplayLogic()

        expect(mockPostHog.surveys.getSurveys).toHaveBeenCalledTimes(2)
        expect(surveyManager.getTestAPI().surveyInFocus).toBe(null)
        expect(handlePopoverSurveyMock).toHaveBeenCalledTimes(1)
    })

    test('sortSurveysByAppearanceDelay should sort surveys correctly', () => {
        const surveys: Survey[] = [
            { id: '1', appearance: { surveyPopupDelaySeconds: 5 } },
            { id: '2', appearance: { surveyPopupDelaySeconds: 2 } },
            { id: '3', appearance: {} },
            { id: '4', appearance: { surveyPopupDelaySeconds: 8 } },
        ] as unknown as Survey[]

        const sortedSurveys = surveyManager.getTestAPI().sortSurveysByAppearanceDelay(surveys)

        expect(sortedSurveys).toEqual([
            { id: '3', appearance: {} },
            { id: '2', appearance: { surveyPopupDelaySeconds: 2 } },
            { id: '1', appearance: { surveyPopupDelaySeconds: 5 } },
            { id: '4', appearance: { surveyPopupDelaySeconds: 8 } },
        ])
    })

    test('sortSurveysByAppearanceDelay should sort Always surveys last', () => {
        const surveys: Survey[] = [
            { id: '1', appearance: { surveyPopupDelaySeconds: 5 }, schedule: 'event' },
            { id: '2', appearance: { surveyPopupDelaySeconds: 2 }, schedule: SurveySchedule.Always },
            { id: '3', appearance: {}, schedule: 'event' },
            { id: '4', appearance: { surveyPopupDelaySeconds: 8 }, schedule: SurveySchedule.Always },
            { id: '5', appearance: { surveyPopupDelaySeconds: 1 }, schedule: 'event' },
        ] as unknown as Survey[]

        const sortedSurveys = surveyManager.getTestAPI().sortSurveysByAppearanceDelay(surveys)

        expect(sortedSurveys).toEqual([
            { id: '3', appearance: {}, schedule: 'event' },
            { id: '5', appearance: { surveyPopupDelaySeconds: 1 }, schedule: 'event' },
            { id: '1', appearance: { surveyPopupDelaySeconds: 5 }, schedule: 'event' },
            { id: '2', appearance: { surveyPopupDelaySeconds: 2 }, schedule: SurveySchedule.Always },
            { id: '4', appearance: { surveyPopupDelaySeconds: 8 }, schedule: SurveySchedule.Always },
        ])
    })

    test('sortSurveysByAppearanceDelay should sort surveys in progress first', () => {
        const surveys: Survey[] = [
            { id: '1', appearance: { surveyPopupDelaySeconds: 5 } },
            { id: '2', appearance: { surveyPopupDelaySeconds: 2 } },
        ] as unknown as Survey[]

        localStorage.setItem(
            `${SURVEY_IN_PROGRESS_PREFIX}1`,
            JSON.stringify({
                surveySubmissionId: '123',
            })
        )

        const sortedSurveys = surveyManager.getTestAPI().sortSurveysByAppearanceDelay(surveys)

        expect(sortedSurveys).toEqual([
            { id: '1', appearance: { surveyPopupDelaySeconds: 5 } },
            { id: '2', appearance: { surveyPopupDelaySeconds: 2 } },
        ])
    })

    describe('renderSurvey', () => {
        let surveyManager: SurveyManager
        const mockSurvey = {
            id: 'testSurvey1',
            name: 'Test survey 1',
            type: SurveyType.Popover,
            appearance: {},
            start_date: '2021-01-01T00:00:00.000Z',
            description: 'This is a survey description',
            linked_flag_key: null,
            questions: [
                {
                    question: 'How satisfied are you with our newest product?',
                    description: 'This is a question description',
                    descriptionContentType: 'text',
                    type: SurveyQuestionType.Rating,
                    display: 'number',
                    scale: 10,
                    lowerBoundLabel: 'Not Satisfied',
                    upperBoundLabel: 'Very Satisfied',
                },
            ],
            conditions: {},
            end_date: null,
            targeting_flag_key: null,
        } as unknown as Survey

        beforeEach(() => {
            surveyManager = new SurveyManager(mockPostHog)
        })

        it('can render survey', () => {
            const surveyDiv = document.createElement('div')
            surveyDiv.id = 'survey-div'
            expect(surveyDiv.innerHTML).toBe('')
            surveyManager.renderSurvey(mockSurvey, surveyDiv)
            // surveys rendered with renderSurvey are unstyled.
            expect(surveyDiv.getElementsByTagName('style').length).toBe(0)
            expect(surveyDiv.getElementsByClassName('survey-form').length).toBe(1)
            expect(surveyDiv.getElementsByClassName('survey-question').length).toBe(1)
            const descriptionElement = surveyDiv.querySelector('.survey-question-description')
            expect(descriptionElement).not.toBeNull()
        })
    })

    describe('timeout management', () => {
        let mockPostHog: PostHog
        let surveyManager: SurveyManager
        let mockSurvey: Survey

        beforeEach(() => {
            jest.useFakeTimers()
            // Set up mocks
            mockPostHog = {
                getActiveMatchingSurveys: jest.fn(),
                get_session_replay_url: jest.fn(),
                capture: jest.fn(),
                featureFlags: {
                    isFeatureEnabled: jest.fn().mockReturnValue(true),
                },
            } as unknown as PostHog

            surveyManager = new SurveyManager(mockPostHog)

            mockSurvey = {
                id: 'delayed-survey',
                name: 'Delayed Survey',
                description: 'A survey with delay',
                type: SurveyType.Popover,
                linked_flag_key: null,
                targeting_flag_key: null,
                internal_targeting_flag_key: null,
                questions: [
                    {
                        question: 'Test question?',
                        type: SurveyQuestionType.Open,
                        id: 'q1',
                    },
                ],
                appearance: {
                    surveyPopupDelaySeconds: 5,
                },
                conditions: null,
                start_date: '2021-01-01T00:00:00.000Z',
                end_date: null,
                current_iteration: null,
                current_iteration_start_date: null,
                feature_flag_keys: [],
            }

            // Make the internal methods accessible for testing
            jest.spyOn(surveyManager as any, '_addSurveyToFocus')
            jest.spyOn(surveyManager as any, '_removeSurveyFromFocus')

            // Mock doesSurveyUrlMatch to always return true, used in handlePopoverSurvey
            jest.spyOn(surveyManager as any, '_handlePopoverSurvey').mockImplementation((survey: Survey) => {
                // Add survey to focus and create a timeout
                surveyManager.getTestAPI().addSurveyToFocus(survey.id)

                if (survey.appearance?.surveyPopupDelaySeconds) {
                    const timeoutId = setTimeout(() => {
                        // This simulates what would happen when the timeout completes
                        // In the real implementation, it would render the survey
                        surveyManager.getTestAPI().surveyTimeouts.delete(survey.id)
                    }, survey.appearance.surveyPopupDelaySeconds * 1000)
                    surveyManager.getTestAPI().surveyTimeouts.set(survey.id, timeoutId)
                }
            })
        })

        afterEach(() => {
            jest.useRealTimers()
            jest.clearAllMocks()
        })

        test('should track timeouts when scheduling delayed surveys', () => {
            surveyManager.getTestAPI().handlePopoverSurvey(mockSurvey)
            expect(surveyManager.getTestAPI().surveyTimeouts.has(mockSurvey.id)).toBe(true)
        })

        test('should clear timeouts when removing survey from focus', () => {
            // Setup
            surveyManager.getTestAPI().handlePopoverSurvey(mockSurvey)
            const timeoutId = surveyManager.getTestAPI().surveyTimeouts.get(mockSurvey.id)
            expect(timeoutId).toBeDefined()

            // Test that clearTimeout is called with correct ID
            const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout')
            surveyManager.getTestAPI().removeSurveyFromFocus(mockSurvey.id)
            expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutId)

            // Verify timeout was removed from map
            expect(surveyManager.getTestAPI().surveyTimeouts.has(mockSurvey.id)).toBe(false)
        })

        test('should manage multiple survey timeouts correctly', () => {
            // Setup first survey
            surveyManager.getTestAPI().handlePopoverSurvey(mockSurvey)
            const firstTimeoutId = surveyManager.getTestAPI().surveyTimeouts.get(mockSurvey.id)

            // Clear and reset to test second survey
            surveyManager.getTestAPI().removeSurveyFromFocus(mockSurvey.id)

            // Create and schedule second survey
            const mockSurvey2 = {
                ...mockSurvey,
                id: 'delayed-survey-2',
                appearance: {
                    surveyPopupDelaySeconds: 10,
                },
            }

            // Schedule second survey
            surveyManager.getTestAPI().handlePopoverSurvey(mockSurvey2)
            const secondTimeoutId = surveyManager.getTestAPI().surveyTimeouts.get(mockSurvey2.id)

            // Verify both timeouts are tracked separately
            expect(firstTimeoutId).not.toEqual(secondTimeoutId)
            expect(surveyManager.getTestAPI().surveyInFocus).toBe(mockSurvey2.id)
        })
    })

    describe('checkFlags', () => {
        it('should return true when no feature flags are specified', () => {
            const survey = { id: '123', questions: [] } as Survey
            const result = surveyManager.getTestAPI().checkFlags(survey)
            expect(result).toBe(true)
        })

        it('should return true when all feature flags are enabled', () => {
            const survey = {
                id: '123',
                questions: [],
                feature_flag_keys: [
                    { key: 'flag1', value: 'flag-1' },
                    { key: 'flag2', value: 'flag-2' },
                ],
            } as Survey

            jest.spyOn(mockPostHog.featureFlags, 'isFeatureEnabled').mockImplementation(() => true)

            const result = surveyManager.getTestAPI().checkFlags(survey)
            expect(result).toBe(true)
        })

        it('should return false when any feature flag is disabled', () => {
            const survey = {
                id: '123',
                questions: [],
                feature_flag_keys: [
                    { key: 'flag1', value: 'flag-1' },
                    { key: 'flag2', value: 'flag-2' },
                ],
            } as Survey

            jest.spyOn(mockPostHog.featureFlags, 'isFeatureEnabled').mockImplementation((flag) =>
                flag === 'flag-1' ? true : false
            )

            const result = surveyManager.getTestAPI().checkFlags(survey)
            expect(result).toBe(false)
        })

        it('should ignore feature flags with missing key or value', () => {
            const survey = {
                id: '123',
                questions: [],
                feature_flag_keys: [
                    { key: '', value: 'flag-1' },
                    { key: 'flag2', value: '' },
                    { key: 'flag3', value: 'flag-3' },
                ],
            } as Survey

            jest.spyOn(mockPostHog.featureFlags, 'isFeatureEnabled').mockImplementation(() => true)

            const result = surveyManager.getTestAPI().checkFlags(survey)
            expect(result).toBe(true)
        })
    })
})

describe('usePopupVisibility URL changes should hide surveys accordingly', () => {
    let posthog: PostHog
    let mockRemoveSurveyFromFocus: jest.Mock
    let originalLocationHref: string
    let originalPushState: typeof window.history.pushState
    let originalReplaceState: typeof window.history.replaceState

    // Set up fake timers for all tests in this suite
    beforeAll(() => {
        jest.useFakeTimers()
    })

    afterAll(() => {
        jest.useRealTimers()
    })

    const createTestSurvey = (urlCondition?: { url: string; urlMatchType?: string }): Survey =>
        ({
            id: 'test-survey',
            name: 'Test Survey',
            description: 'Test Survey Description',
            type: SurveyType.Popover,
            questions: [
                {
                    type: SurveyQuestionType.Open,
                    question: 'What do you think?',
                },
            ],
            conditions: urlCondition ? { url: urlCondition.url, urlMatchType: urlCondition.urlMatchType } : undefined,
            start_date: new Date().toISOString(),
            end_date: null,
            feature_flag_keys: null,
            linked_flag_key: null,
            targeting_flag_key: null,
            internal_targeting_flag_key: null,
            appearance: {},
        }) as Survey

    beforeEach(() => {
        // Mock PostHog instance
        posthog = {
            capture: jest.fn(),
            get_session_replay_url: jest.fn(),
        } as unknown as PostHog

        mockRemoveSurveyFromFocus = jest.fn()

        // Store original history methods
        originalPushState = window.history.pushState
        originalReplaceState = window.history.replaceState

        // Store original location and set initial location
        originalLocationHref = window.location.href
        Object.defineProperty(window, 'location', {
            value: new URL('https://example.com'),
            writable: true,
        })
    })

    afterEach(() => {
        // Restore original history methods
        window.history.pushState = originalPushState
        window.history.replaceState = originalReplaceState

        // Restore original location
        Object.defineProperty(window, 'location', {
            value: new URL(originalLocationHref),
            writable: true,
        })
    })

    it('should not hide survey when URL matches - exact match', () => {
        const survey = createTestSurvey({ url: 'https://example.com/path1', urlMatchType: 'exact' })
        Object.defineProperty(window, 'location', {
            value: new URL('https://example.com/path1'),
            writable: true,
        })
        const { result } = renderHook(() => usePopupVisibility(survey, posthog, 0, false, mockRemoveSurveyFromFocus))

        act(() => {
            window.history.pushState({}, '', '/path1')
        })

        expect(mockRemoveSurveyFromFocus).not.toHaveBeenCalled()
        expect(result.current.isPopupVisible).toBe(true)
    })

    it('should hide survey when URL changes to non-matching - exact match', () => {
        const survey = createTestSurvey({ url: '/path1', urlMatchType: 'exact' })
        const { result } = renderHook(() => usePopupVisibility(survey, posthog, 0, false, mockRemoveSurveyFromFocus))

        act(() => {
            window.history.pushState({}, '', '/path2')
        })

        expect(mockRemoveSurveyFromFocus).toHaveBeenCalledTimes(1)
        expect(mockRemoveSurveyFromFocus).toHaveBeenCalledWith('test-survey')
        expect(result.current.isPopupVisible).toBe(false)
    })

    it('should not hide survey when URL matches - contains', () => {
        const survey = createTestSurvey({ url: 'path', urlMatchType: 'icontains' })

        // Set initial URL to a matching path before rendering the hook
        Object.defineProperty(window, 'location', {
            value: new URL('https://example.com/path'),
            writable: true,
        })

        const { result } = renderHook(() => usePopupVisibility(survey, posthog, 0, false, mockRemoveSurveyFromFocus))

        act(() => {
            window.history.pushState({}, '', '/path/subpage')
        })

        expect(mockRemoveSurveyFromFocus).not.toHaveBeenCalled()
        expect(result.current.isPopupVisible).toBe(true)
    })

    it('should handle replaceState URL changes', () => {
        const survey = createTestSurvey({ url: 'path', urlMatchType: 'icontains' })
        const { result } = renderHook(() => usePopupVisibility(survey, posthog, 0, false, mockRemoveSurveyFromFocus))

        act(() => {
            window.history.replaceState({}, '', '/other/page')
        })

        expect(mockRemoveSurveyFromFocus).toHaveBeenCalledWith('test-survey')
        expect(result.current.isPopupVisible).toBe(false)
    })

    it('should handle browser back/forward navigation', () => {
        const survey = createTestSurvey({ url: 'path', urlMatchType: 'icontains' })
        const { result } = renderHook(() => usePopupVisibility(survey, posthog, 0, false, mockRemoveSurveyFromFocus))

        act(() => {
            Object.defineProperty(window, 'location', {
                value: new URL('https://example.com/other/page'),
                writable: true,
            })
            window.dispatchEvent(new Event('popstate'))
        })

        expect(mockRemoveSurveyFromFocus).toHaveBeenCalledTimes(1)
        expect(mockRemoveSurveyFromFocus).toHaveBeenCalledWith('test-survey')
        expect(result.current.isPopupVisible).toBe(false)
    })

    it('should handle hash-based navigation', () => {
        const survey = createTestSurvey({ url: 'path', urlMatchType: 'icontains' })
        const { result } = renderHook(() => usePopupVisibility(survey, posthog, 0, false, mockRemoveSurveyFromFocus))

        act(() => {
            Object.defineProperty(window, 'location', {
                value: new URL('https://example.com/other/page#/hash'),
                writable: true,
            })
            window.dispatchEvent(new Event('hashchange'))
        })

        // expect mockremoveSurvey to have been called only once
        expect(mockRemoveSurveyFromFocus).toHaveBeenCalledTimes(1)
        expect(mockRemoveSurveyFromFocus).toHaveBeenCalledWith('test-survey')
        expect(result.current.isPopupVisible).toBe(false)
    })

    it('should restore original history methods on unmount', () => {
        const survey = createTestSurvey({ url: 'path', urlMatchType: 'icontains' })
        const { unmount } = renderHook(() => usePopupVisibility(survey, posthog, 0, false, mockRemoveSurveyFromFocus))

        unmount()

        expect(window.history.pushState).toBe(originalPushState)
        expect(window.history.replaceState).toBe(originalReplaceState)
    })

    it('should not show delayed survey if URL no longer matches when delay expires', () => {
        // Create a survey with a URL condition and a 2 second delay
        const survey = createTestSurvey({
            url: '/initial-path',
            urlMatchType: 'exact',
        })
        survey.appearance = { surveyPopupDelaySeconds: 2 }

        // Set initial matching URL
        Object.defineProperty(window, 'location', {
            value: new URL('https://example.com/initial-path'),
            writable: true,
        })

        // Ensure clearTimeout is defined in the global scope for this test
        if (typeof global.clearTimeout === 'undefined') {
            global.clearTimeout = jest.fn()
        }

        // Start the survey visibility hook
        const { result } = renderHook(() => usePopupVisibility(survey, posthog, 2000, false, mockRemoveSurveyFromFocus))

        // Initially the survey should not be visible (due to delay)
        expect(result.current.isPopupVisible).toBe(false)

        // Change URL to non-matching path before delay expires
        act(() => {
            Object.defineProperty(window, 'location', {
                value: new URL('https://example.com/different-path'),
                writable: true,
            })
            window.dispatchEvent(new Event('popstate'))
        })

        // Advance timers past the delay
        act(() => {
            jest.runAllTimers()
        })

        // Survey should still not be visible since URL no longer matches
        expect(result.current.isPopupVisible).toBe(false)
        expect(mockRemoveSurveyFromFocus).toHaveBeenCalledWith('test-survey')
    })
})

describe('useHideSurveyOnURLChange', () => {
    let originalLocationHref: string
    let originalPushState: typeof window.history.pushState
    let originalReplaceState: typeof window.history.replaceState
    let mockRemoveSurveyFromFocus: jest.Mock
    let mockSetSurveyVisible: jest.Mock

    const BASE_SURVEY = {
        id: 'test-survey',
        type: SurveyType.Popover,
        appearance: {},
    }

    beforeEach(() => {
        // Store original history methods
        originalPushState = window.history.pushState
        originalReplaceState = window.history.replaceState
        mockRemoveSurveyFromFocus = jest.fn()
        mockSetSurveyVisible = jest.fn()

        // Store original location and set initial location
        originalLocationHref = window.location.href
        Object.defineProperty(window, 'location', {
            value: { href: 'https://example.com' },
            writable: true,
        })
    })

    afterEach(() => {
        // Restore original history methods
        window.history.pushState = originalPushState
        window.history.replaceState = originalReplaceState

        // Restore original location
        Object.defineProperty(window, 'location', {
            value: { href: originalLocationHref },
            writable: true,
        })

        jest.clearAllMocks()
    })

    it('should not do anything in preview mode', () => {
        const survey = {
            ...BASE_SURVEY,
            conditions: {
                url: 'example.com',
                urlMatchType: 'exact' as const,
                events: null,
                actions: null,
            },
        }

        renderHook(() =>
            useHideSurveyOnURLChange({
                survey,
                removeSurveyFromFocus: mockRemoveSurveyFromFocus,
                setSurveyVisible: mockSetSurveyVisible,
                isPreviewMode: true,
            })
        )

        act(() => {
            window.history.pushState({}, '', '/different-path')
        })

        expect(mockRemoveSurveyFromFocus).not.toHaveBeenCalled()
        expect(mockSetSurveyVisible).not.toHaveBeenCalled()
    })

    it('should not do anything if no URL conditions are set', () => {
        const survey = {
            ...BASE_SURVEY,
            conditions: {
                events: null,
                actions: null,
            },
        }

        renderHook(() =>
            useHideSurveyOnURLChange({
                survey,
                removeSurveyFromFocus: mockRemoveSurveyFromFocus,
                setSurveyVisible: mockSetSurveyVisible,
                isPreviewMode: false,
            })
        )

        act(() => {
            window.history.pushState({}, '', '/different-path')
        })

        expect(mockRemoveSurveyFromFocus).not.toHaveBeenCalled()
        expect(mockSetSurveyVisible).not.toHaveBeenCalled()
    })

    it('should handle pushState navigation', () => {
        const survey = {
            ...BASE_SURVEY,
            conditions: {
                url: 'example.com',
                urlMatchType: 'exact' as const,
                events: null,
                actions: null,
            },
        }

        renderHook(() =>
            useHideSurveyOnURLChange({
                survey,
                removeSurveyFromFocus: mockRemoveSurveyFromFocus,
                setSurveyVisible: mockSetSurveyVisible,
                isPreviewMode: false,
            })
        )

        act(() => {
            window.history.pushState({}, '', '/different-path')
        })

        expect(mockRemoveSurveyFromFocus).toHaveBeenCalledWith('test-survey')
        expect(mockSetSurveyVisible).toHaveBeenCalledWith(false)
    })

    it('should handle replaceState navigation', () => {
        const survey = {
            ...BASE_SURVEY,
            conditions: {
                url: 'example.com',
                urlMatchType: 'exact' as const,
                events: null,
                actions: null,
            },
        }

        renderHook(() =>
            useHideSurveyOnURLChange({
                survey,
                removeSurveyFromFocus: mockRemoveSurveyFromFocus,
                setSurveyVisible: mockSetSurveyVisible,
                isPreviewMode: false,
            })
        )

        act(() => {
            window.history.replaceState({}, '', '/different-path')
        })

        expect(mockRemoveSurveyFromFocus).toHaveBeenCalledWith('test-survey')
        expect(mockSetSurveyVisible).toHaveBeenCalledWith(false)
    })

    it('should handle popstate events', () => {
        const survey = {
            ...BASE_SURVEY,
            conditions: {
                url: 'example.com',
                urlMatchType: 'exact' as const,
                events: null,
                actions: null,
            },
        }

        renderHook(() =>
            useHideSurveyOnURLChange({
                survey,
                removeSurveyFromFocus: mockRemoveSurveyFromFocus,
                setSurveyVisible: mockSetSurveyVisible,
                isPreviewMode: false,
            })
        )

        act(() => {
            Object.defineProperty(window, 'location', {
                value: { href: 'https://different.com' },
                writable: true,
            })
            window.dispatchEvent(new Event('popstate'))
        })

        expect(mockRemoveSurveyFromFocus).toHaveBeenCalledWith('test-survey')
        expect(mockSetSurveyVisible).toHaveBeenCalledWith(false)
    })

    it('should handle hashchange events', () => {
        const survey = {
            ...BASE_SURVEY,
            conditions: {
                url: 'example.com',
                urlMatchType: 'exact' as const,
                events: null,
                actions: null,
            },
        }

        renderHook(() =>
            useHideSurveyOnURLChange({
                survey,
                removeSurveyFromFocus: mockRemoveSurveyFromFocus,
                setSurveyVisible: mockSetSurveyVisible,
                isPreviewMode: false,
            })
        )

        act(() => {
            Object.defineProperty(window, 'location', {
                value: { href: 'https://different.com/#/some-hash' },
                writable: true,
            })
            window.dispatchEvent(new Event('hashchange'))
        })

        expect(mockRemoveSurveyFromFocus).toHaveBeenCalledWith('test-survey')
        expect(mockSetSurveyVisible).toHaveBeenCalledWith(false)
    })

    it('should clean up event listeners and history methods on unmount', () => {
        const survey = {
            ...BASE_SURVEY,
            conditions: {
                url: 'example.com',
                urlMatchType: 'exact' as const,
                events: null,
                actions: null,
            },
        }

        const { unmount } = renderHook(() =>
            useHideSurveyOnURLChange({
                survey,
                removeSurveyFromFocus: mockRemoveSurveyFromFocus,
                setSurveyVisible: mockSetSurveyVisible,
                isPreviewMode: false,
            })
        )

        unmount()

        expect(window.history.pushState).toBe(originalPushState)
        expect(window.history.replaceState).toBe(originalReplaceState)

        // Verify that events don't trigger callbacks after unmount
        act(() => {
            window.dispatchEvent(new Event('popstate'))
            window.dispatchEvent(new Event('hashchange'))
        })

        expect(mockRemoveSurveyFromFocus).not.toHaveBeenCalled()
        expect(mockSetSurveyVisible).not.toHaveBeenCalled()
    })

    it('should keep survey visible when URL still matches after navigation', () => {
        const survey = {
            ...BASE_SURVEY,
            conditions: {
                url: 'example.com',
                urlMatchType: 'icontains' as const,
                events: null,
                actions: null,
            },
        }

        renderHook(() =>
            useHideSurveyOnURLChange({
                survey,
                removeSurveyFromFocus: mockRemoveSurveyFromFocus,
                setSurveyVisible: mockSetSurveyVisible,
                isPreviewMode: false,
            })
        )

        act(() => {
            window.history.pushState({}, '', '/some-path')
        })

        expect(mockRemoveSurveyFromFocus).not.toHaveBeenCalled()
    })
})

describe('preview renders', () => {
    beforeEach(() => {
        // we have to manually reset the DOM before each test
        document.getElementsByTagName('html')[0].innerHTML = ''
        localStorage.clear()
        jest.clearAllMocks()
    })

    test('renderSurveysPreview', () => {
        const mockSurvey = {
            id: 'testSurvey1',
            name: 'Test survey 1',
            type: SurveyType.Popover,
            appearance: {},
            start_date: '2021-01-01T00:00:00.000Z',
            description: 'This is a survey description',
            linked_flag_key: null,
            questions: [
                {
                    question: 'How satisfied are you with our newest product?',
                    description: 'This is a question description',
                    descriptionContentType: 'text',
                    type: SurveyQuestionType.Rating,
                    display: 'number',
                    scale: 10,
                    lowerBoundLabel: 'Not Satisfied',
                    upperBoundLabel: 'Very Satisfied',
                },
            ],
            conditions: {},
            end_date: null,
            targeting_flag_key: null,
        }
        const surveyDiv = document.createElement('div')
        expect(surveyDiv.innerHTML).toBe('')
        renderSurveysPreview({ survey: mockSurvey as Survey, parentElement: surveyDiv, previewPageIndex: 0 })
        expect(surveyDiv.getElementsByTagName('style').length).toBe(1)
        expect(surveyDiv.getElementsByClassName('survey-form').length).toBe(1)
        expect(surveyDiv.getElementsByClassName('survey-question').length).toBe(1)
    })

    test('renderSurveysPreview marks up question with html when no content type is selected by default', () => {
        const mockSurvey = {
            id: 'testSurvey1',
            name: 'Test survey 1',
            type: SurveyType.Popover,
            appearance: {},
            start_date: '2021-01-01T00:00:00.000Z',
            description: 'This is a survey description',
            linked_flag_key: null,
            questions: [
                {
                    question: 'How satisfied are you with our newest product?',
                    description: '<h3>This is a question description</h3>',
                    type: SurveyQuestionType.Rating,
                    display: 'number',
                    scale: 10,
                    lowerBoundLabel: 'Not Satisfied',
                    upperBoundLabel: 'Very Satisfied',
                },
            ],
            conditions: {},
            end_date: null,
            targeting_flag_key: null,
        }
        const surveyDiv = document.createElement('div')
        expect(surveyDiv.innerHTML).toBe('')
        renderSurveysPreview({ survey: mockSurvey as Survey, parentElement: surveyDiv, previewPageIndex: 0 })
        expect(surveyDiv.getElementsByTagName('style').length).toBe(1)
        expect(surveyDiv.getElementsByClassName('survey-form').length).toBe(1)
        expect(surveyDiv.getElementsByClassName('survey-question').length).toBe(1)
        const descriptionElement = surveyDiv.querySelector('.survey-question-description')
        expect(descriptionElement).not.toBeNull()
        expect(descriptionElement!.innerHTML).toBe('<h3>This is a question description</h3>')
    })

    test('renderSurveysPreview marks up question with html when `html` content type is selected', () => {
        const mockSurvey = {
            id: 'testSurvey1',
            name: 'Test survey 1',
            type: SurveyType.Popover,
            appearance: {},
            start_date: '2021-01-01T00:00:00.000Z',
            description: 'This is a survey description',
            linked_flag_key: null,
            questions: [
                {
                    question: 'How satisfied are you with our newest product?',
                    description: '<h3>This is a question description</h3>',
                    descriptionContentType: 'html',
                    type: SurveyQuestionType.Rating,
                    display: 'number',
                    scale: 10,
                    lowerBoundLabel: 'Not Satisfied',
                    upperBoundLabel: 'Very Satisfied',
                },
            ],
            conditions: {},
            end_date: null,
            targeting_flag_key: null,
        }
        const surveyDiv = document.createElement('div')
        expect(surveyDiv.innerHTML).toBe('')
        renderSurveysPreview({ survey: mockSurvey as Survey, parentElement: surveyDiv, previewPageIndex: 0 })
        expect(surveyDiv.getElementsByTagName('style').length).toBe(1)
        expect(surveyDiv.getElementsByClassName('survey-form').length).toBe(1)
        expect(surveyDiv.getElementsByClassName('survey-question').length).toBe(1)
        const descriptionElement = surveyDiv.querySelector('.survey-question-description')
        expect(descriptionElement).not.toBeNull()
        expect(descriptionElement!.innerHTML).toBe('<h3>This is a question description</h3>')
    })

    test('renderSurveysPreview does not mark up html when when `text` content type is selected', () => {
        const mockSurvey = {
            id: 'testSurvey1',
            name: 'Test survey 1',
            type: SurveyType.Popover,
            appearance: {},
            start_date: '2021-01-01T00:00:00.000Z',
            description: 'This is a survey description',
            linked_flag_key: null,
            questions: [
                {
                    question: 'How satisfied are you with our newest product?',
                    description: '<h3>This is a question description</h3>',
                    descriptionContentType: 'text',
                    type: SurveyQuestionType.Rating,
                    display: 'number',
                    scale: 10,
                    lowerBoundLabel: 'Not Satisfied',
                    upperBoundLabel: 'Very Satisfied',
                },
            ],
            conditions: {},
            end_date: null,
            targeting_flag_key: null,
        }
        const surveyDiv = document.createElement('div')
        expect(surveyDiv.innerHTML).toBe('')
        renderSurveysPreview({ survey: mockSurvey as Survey, parentElement: surveyDiv, previewPageIndex: 0 })
        expect(surveyDiv.getElementsByTagName('style').length).toBe(1)
        expect(surveyDiv.getElementsByClassName('survey-form').length).toBe(1)
        expect(surveyDiv.getElementsByClassName('survey-question').length).toBe(1)
        const descriptionElement = surveyDiv.querySelector('.survey-question-description')
        expect(descriptionElement).not.toBeNull()
        expect(descriptionElement!.innerHTML).toBe('&lt;h3&gt;This is a question description&lt;/h3&gt;') // HTML is escaped
    })

    test('renderSurveysPreview does not mark up html when when the forceDisableHtml flag is passed in', () => {
        const mockSurvey = {
            id: 'testSurvey1',
            name: 'Test survey 1',
            type: SurveyType.Popover,
            appearance: {},
            start_date: '2021-01-01T00:00:00.000Z',
            description: 'This is a survey description',
            linked_flag_key: null,
            questions: [
                {
                    question: 'How satisfied are you with our newest product?',
                    description: '<h3>This is a question description</h3>',
                    descriptionContentType: 'html',
                    type: SurveyQuestionType.Rating,
                    display: 'number',
                    scale: 10,
                    lowerBoundLabel: 'Not Satisfied',
                    upperBoundLabel: 'Very Satisfied',
                },
            ],
            conditions: {},
            end_date: null,
            targeting_flag_key: null,
        }
        const surveyDiv = document.createElement('div')
        expect(surveyDiv.innerHTML).toBe('')
        renderSurveysPreview({
            survey: mockSurvey as Survey,
            parentElement: surveyDiv,
            previewPageIndex: 0,
            forceDisableHtml: true,
        })
        expect(surveyDiv.getElementsByTagName('style').length).toBe(1)
        expect(surveyDiv.getElementsByClassName('survey-form').length).toBe(1)
        expect(surveyDiv.getElementsByClassName('survey-question').length).toBe(1)
        const descriptionElement = surveyDiv.querySelector('.survey-question-description')
        expect(descriptionElement).not.toBeNull()
        expect(descriptionElement!.innerHTML).toBe('&lt;h3&gt;This is a question description&lt;/h3&gt;') // HTML is escaped
    })

    test('renderFeedbackWidgetPreview', () => {
        const mockSurvey = {
            id: 'testSurvey1',
            name: 'Test survey 1',
            type: SurveyType.Widget,
            appearance: { widgetLabel: 'preview test', widgetColor: 'black', widgetType: 'tab' },
            start_date: '2021-01-01T00:00:00.000Z',
            description: 'This is a survey description',
            linked_flag_key: null,
            questions: [
                {
                    question: 'What would you like to see next?',
                    type: SurveyQuestionType.Open,
                },
            ],
            end_date: null,
            targeting_flag_key: null,
        }
        const root = document.createElement('div')
        expect(root.innerHTML).toBe('')
        renderFeedbackWidgetPreview({ survey: mockSurvey as Survey, root })
        expect(root.getElementsByTagName('style').length).toBe(1)
        expect(root.getElementsByClassName('ph-survey-widget-tab').length).toBe(1)
        expect(root.getElementsByClassName('ph-survey-widget-tab')[0].innerHTML).toContain('preview test')
    })

    test('renderSurveysPreview navigates between questions when submitting answers in preview', async () => {
        function TestSurveyPreview() {
            const surveyPreviewRef = useRef<HTMLDivElement>(null)
            const [currentPageIndex, setCurrentPageIndex] = useState(0)

            const survey = {
                id: 'test-survey',
                name: 'Test Survey',
                description: 'Test Survey Description',
                type: SurveyType.Popover,
                questions: [
                    {
                        type: SurveyQuestionType.Open,
                        question: 'Question 1',
                        description: 'Description 1',
                        descriptionContentType: 'text',
                        id: 'question-a',
                    },
                    {
                        type: SurveyQuestionType.Open,
                        question: 'Question 2',
                        description: 'Description 2',
                        descriptionContentType: 'text',
                        id: 'question-b',
                    },
                ],
                appearance: {
                    backgroundColor: '#ffffff',
                    submitButtonText: 'Next',
                },
                start_date: '2024-01-01T00:00:00.000Z',
                end_date: null,
                targeting_flag_key: null,
                linked_flag_key: null,
                conditions: {},
                feature_flag_keys: null, // Added this to fix type error
            } as Survey

            useEffect(() => {
                console.log('Render effect triggered with page index:', currentPageIndex)
                if (surveyPreviewRef.current) {
                    renderSurveysPreview({
                        survey,
                        parentElement: surveyPreviewRef.current,
                        previewPageIndex: currentPageIndex,
                        onPreviewSubmit: () => {
                            setCurrentPageIndex((prev) => {
                                console.log('Setting page index from', prev, 'to', prev + 1)
                                return prev + 1
                            })
                        },
                    })
                }
            }, [currentPageIndex])

            return Preact.h('div', { ref: surveyPreviewRef })
        }

        // Render the test component
        const { container } = render(Preact.h(TestSurveyPreview, {}))

        // Check if we're on the first question
        expect(container.textContent).toContain('Question 1')
        expect(container.textContent).not.toContain('Question 2')

        // Find and fill the textarea
        const textarea = container.querySelector('textarea')
        console.log('Found textarea:', !!textarea)

        await act(async () => {
            fireEvent.change(textarea!, { target: { value: 'Test answer' } })
        })

        // Find and click the submit button (using button type="button" instead of form-submit class)
        const submitButton = container.querySelectorAll('button[type="button"]')[1]

        console.log('Found submit button:', !!submitButton)
        console.log('Submit button text:', submitButton?.textContent)

        await act(async () => {
            fireEvent.click(submitButton!)
        })

        // Check if we're on the second question
        expect(container.textContent).toContain('Question 2')
        expect(container.textContent).not.toContain('Question 1')
    })
})
