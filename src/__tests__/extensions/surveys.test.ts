import {
    generateSurveys,
    renderSurveysPreview,
    renderFeedbackWidgetPreview,
    usePopupVisibility,
    SurveyManager,
} from '../../extensions/surveys'
import { createShadow } from '../../extensions/surveys/surveys-utils'
import { Survey, SurveyQuestionType, SurveyType } from '../../posthog-surveys-types'
import { renderHook, act } from '@testing-library/preact'

import '@testing-library/jest-dom'
import { PostHog } from '../../posthog-core'

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
        expect(mockShadow.host.className).toBe(`PostHogSurvey${surveyId}`)
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
                    originalQuestionIndex: 0,
                },
            ],
            appearance: null,
            conditions: null,
            start_date: '2021-01-01T00:00:00.000Z',
            end_date: null,
            current_iteration: null,
            current_iteration_start_date: null,
        },
    ]

    const mockPostHog = {
        getActiveMatchingSurveys: jest.fn().mockImplementation((callback) => callback(mockSurveys)),
        get_session_replay_url: jest.fn(),
        capture: jest.fn().mockImplementation((eventName) => eventName),
    } as unknown as PostHog

    test('callSurveysAndEvaluateDisplayLogic runs on interval irrespective of url change', () => {
        jest.useFakeTimers()
        jest.spyOn(global, 'setInterval')
        generateSurveys(mockPostHog)
        expect(mockPostHog.getActiveMatchingSurveys).toBeCalledTimes(1)
        expect(setInterval).toHaveBeenLastCalledWith(expect.any(Function), 1000)

        jest.advanceTimersByTime(1000)
        expect(mockPostHog.getActiveMatchingSurveys).toBeCalledTimes(2)
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
                originalQuestionIndex: 0,
            },
        ],
        appearance: {},
        conditions: null,
        start_date: '2021-01-01T00:00:00.000Z',
        end_date: null,
        current_iteration: null,
        current_iteration_start_date: null,
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
            window.dispatchEvent(new Event('PHSurveyClosed'))
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
            window.dispatchEvent(new Event('PHSurveySent'))
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

    beforeEach(() => {
        mockPostHog = {
            getActiveMatchingSurveys: jest.fn(),
            get_session_replay_url: jest.fn(),
            capture: jest.fn(),
        } as unknown as PostHog

        surveyManager = new SurveyManager(mockPostHog)

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
                        originalQuestionIndex: 0,
                    },
                ],
                appearance: {},
                conditions: null,
                start_date: '2021-01-01T00:00:00.000Z',
                end_date: null,
                current_iteration: null,
                current_iteration_start_date: null,
            },
        ]
    })

    test('callSurveysAndEvaluateDisplayLogic should handle a single popover survey correctly', () => {
        mockPostHog.getActiveMatchingSurveys = jest.fn((callback) => callback([mockSurveys[0]]))
        const handlePopoverSurveyMock = jest
            .spyOn(surveyManager as any, 'handlePopoverSurvey')
            .mockImplementation(() => {})
        const canShowNextEventBasedSurveyMock = jest
            .spyOn(surveyManager as any, 'canShowNextEventBasedSurvey')
            .mockReturnValue(true)

        surveyManager.callSurveysAndEvaluateDisplayLogic()

        expect(mockPostHog.getActiveMatchingSurveys).toHaveBeenCalled()
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
        mockPostHog.getActiveMatchingSurveys = jest.fn((callback) => callback([mockSurveys[0]]))

        const handlePopoverSurveyMock = jest
            .spyOn(surveyManager as any, 'handlePopoverSurvey')
            .mockImplementation(() => {})
        const handleWidgetMock = jest.spyOn(surveyManager as any, 'handleWidget').mockImplementation(() => {})
        const handleWidgetSelectorMock = jest
            .spyOn(surveyManager as any, 'handleWidgetSelector')
            .mockImplementation(() => {})
        jest.spyOn(surveyManager as any, 'canShowNextEventBasedSurvey').mockReturnValue(true)

        surveyManager.callSurveysAndEvaluateDisplayLogic()

        expect(mockPostHog.getActiveMatchingSurveys).toHaveBeenCalled()
        expect(handlePopoverSurveyMock).toHaveBeenCalledWith(mockSurveys[0])
        expect(handleWidgetMock).not.toHaveBeenCalled()
        expect(handleWidgetSelectorMock).not.toHaveBeenCalled()
    })

    test('handleWidget should render the widget correctly', () => {
        const mockSurvey = mockSurveys[1]
        const handleWidgetMock = jest.spyOn(surveyManager as any, 'handleWidget').mockImplementation(() => {})
        surveyManager.getTestAPI().handleWidget(mockSurvey)
        expect(handleWidgetMock).toHaveBeenCalledWith(mockSurvey)
    })

    test('handleWidgetSelector should set up the widget selector correctly', () => {
        const mockSurvey: Survey = {
            id: 'testSurvey1',
            name: 'Test survey 1',
            description: 'Test survey description 1',
            type: SurveyType.Widget,
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
                    originalQuestionIndex: 0,
                },
            ],
            appearance: {},
            conditions: null,
            start_date: '2021-01-01T00:00:00.000Z',
            end_date: null,
            current_iteration: null,
            current_iteration_start_date: null,
        }
        document.body.innerHTML = '<div class="widget-selector"></div>'
        const handleWidgetSelectorMock = jest
            .spyOn(surveyManager as any, 'handleWidgetSelector')
            .mockImplementation(() => {})
        surveyManager.getTestAPI().handleWidgetSelector(mockSurvey)
        expect(handleWidgetSelectorMock).toHaveBeenNthCalledWith(1, mockSurvey)
    })

    test('callSurveysAndEvaluateDisplayLogic should not call surveys in focus', () => {
        mockPostHog.getActiveMatchingSurveys = jest.fn((callback) => callback(mockSurveys))

        surveyManager.getTestAPI().addSurveyToFocus('survey1')
        surveyManager.callSurveysAndEvaluateDisplayLogic()

        expect(mockPostHog.getActiveMatchingSurveys).toHaveBeenCalledTimes(1)
        expect(surveyManager.getTestAPI().surveyInFocus).toBe('survey1')
    })

    test('surveyInFocus handling works correctly with in callSurveysAndEvaluateDisplayLogic', () => {
        mockPostHog.getActiveMatchingSurveys = jest.fn((callback) => callback(mockSurveys))

        surveyManager.getTestAPI().addSurveyToFocus('survey1')
        surveyManager.callSurveysAndEvaluateDisplayLogic()

        expect(mockPostHog.getActiveMatchingSurveys).toHaveBeenCalledTimes(1)
        expect(surveyManager.getTestAPI().surveyInFocus).toBe('survey1')

        const handlePopoverSurveyMock = jest
            .spyOn(surveyManager as any, 'handlePopoverSurvey')
            .mockImplementation(() => {})

        surveyManager.getTestAPI().removeSurveyFromFocus('survey1')
        surveyManager.callSurveysAndEvaluateDisplayLogic()

        expect(mockPostHog.getActiveMatchingSurveys).toHaveBeenCalledTimes(2)
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
        const descriptionElement = surveyDiv.querySelector('.description')
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
        const descriptionElement = surveyDiv.querySelector('.description')
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
        const descriptionElement = surveyDiv.querySelector('.description')
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
        const descriptionElement = surveyDiv.querySelector('.description')
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
})
