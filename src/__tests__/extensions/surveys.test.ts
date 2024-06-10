import { generateSurveys, renderSurveysPreview, renderFeedbackWidgetPreview } from '../../extensions/surveys'
import { createShadow } from '../../extensions/surveys/surveys-utils'
import { Survey, SurveyQuestionType, SurveyType } from '../../posthog-surveys-types'

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

    const mockSurveys: any[] = [
        {
            id: 'testSurvey1',
            name: 'Test survey 1',
            type: SurveyType.Popover,
            appearance: null,
            start_date: '2021-01-01T00:00:00.000Z',
            questions: [
                {
                    question: 'How satisfied are you with our newest product?',
                    description: 'This is a question description',
                    type: 'rating',
                    display: 'number',
                    scale: 10,
                    lower_bound_label: 'Not Satisfied',
                    upper_bound_label: 'Very Satisfied',
                },
            ],
        },
    ]
    const mockPostHog = {
        getActiveMatchingSurveys: jest.fn().mockImplementation((callback) => callback(mockSurveys)),
        get_session_replay_url: jest.fn(),
        capture: jest.fn().mockImplementation((eventName) => eventName),
    }

    test('callSurveys runs on interval irrespective of url change', () => {
        jest.useFakeTimers()
        jest.spyOn(global, 'setInterval')
        generateSurveys(mockPostHog)
        expect(mockPostHog.getActiveMatchingSurveys).toBeCalledTimes(1)
        expect(setInterval).toHaveBeenLastCalledWith(expect.any(Function), 3000)

        jest.advanceTimersByTime(3000)
        expect(mockPostHog.getActiveMatchingSurveys).toBeCalledTimes(2)
        expect(setInterval).toHaveBeenLastCalledWith(expect.any(Function), 3000)
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
