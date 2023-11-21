import {
    createShadow,
    callSurveys,
    generateSurveys,
    createMultipleQuestionSurvey,
    createRatingsPopup,
} from '../../extensions/surveys'

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

    let mockSurveys = [
        {
            id: 'testSurvey1',
            name: 'Test survey 1',
            appearance: null,
            questions: [
                {
                    question: 'How satisfied are you with our newest product?',
                    description: 'This is a question description',
                    type: 'rating',
                    display: 'number',
                    scale: 10,
                    lowerBoundLabel: 'Not Satisfied',
                    upperBoundLabel: 'Very Satisfied',
                },
            ],
        },
    ]
    const mockPostHog = {
        getActiveMatchingSurveys: jest.fn().mockImplementation((callback) => callback(mockSurveys)),
        get_session_replay_url: jest.fn(),
        capture: jest.fn().mockImplementation((eventName) => eventName),
    }

    test('does not show survey to user if they have dismissed it before', () => {
        expect(localStorage.getItem(`seenSurvey_${mockSurveys[0].id}`)).toBe(null)
        callSurveys(mockPostHog, false)
        expect(mockPostHog.capture).toBeCalledTimes(1)
        expect(mockPostHog.capture).toBeCalledWith('survey shown', {
            $survey_id: 'testSurvey1',
            $survey_name: 'Test survey 1',
            sessionRecordingUrl: undefined,
        })

        // now we dismiss the survey
        const cancelButton = document
            .getElementsByClassName(`PostHogSurvey${mockSurveys[0].id}`)[0]
            .shadowRoot.querySelectorAll('.form-cancel')[0]
        cancelButton.click()
        expect(mockPostHog.capture).toBeCalledTimes(2)
        expect(mockPostHog.capture).toBeCalledWith('survey dismissed', {
            $survey_id: 'testSurvey1',
            $survey_name: 'Test survey 1',
            sessionRecordingUrl: undefined,
            $set: {
                '$survey_dismissed/testSurvey1': true,
            },
        })
        expect(localStorage.getItem(`seenSurvey_${mockSurveys[0].id}`)).toBe('true')

        // now we clear the DOM to imitate a new page load and call surveys again, and it should not show the survey
        document.getElementsByTagName('html')[0].innerHTML = ''
        callSurveys(mockPostHog, false)
        expect(document.getElementsByClassName(`PostHogSurvey${mockSurveys[0].id}`)[0]).toBe(undefined)
        // no additional capture events are called because the survey is not shown
        expect(mockPostHog.capture).toBeCalledTimes(2)
    })

    test('does not show survey to user if they have already completed it', () => {
        expect(localStorage.getItem(`seenSurvey_${mockSurveys[0].id}`)).toBe(null)
        callSurveys(mockPostHog, false)
        expect(mockPostHog.capture).toBeCalledTimes(1)
        expect(mockPostHog.capture).toBeCalledWith('survey shown', {
            $survey_id: 'testSurvey1',
            $survey_name: 'Test survey 1',
            sessionRecordingUrl: undefined,
        })

        // submit the survey
        const ratingButton = document
            .getElementsByClassName(`PostHogSurvey${mockSurveys[0].id}`)[0]
            .shadowRoot.querySelectorAll('.question-0-rating-1')[0]
        ratingButton.click()
        const submitButton = document
            .getElementsByClassName(`PostHogSurvey${mockSurveys[0].id}`)[0]
            .shadowRoot.querySelectorAll('.form-submit')[0]
        submitButton.click()
        expect(mockPostHog.capture).toBeCalledTimes(2)
        expect(mockPostHog.capture).toBeCalledWith('survey sent', {
            $survey_id: 'testSurvey1',
            $survey_name: 'Test survey 1',
            $survey_question: 'How satisfied are you with our newest product?',
            $survey_response: 1,
            sessionRecordingUrl: undefined,
            $set: {
                '$survey_responded/testSurvey1': true,
            },
        })
        expect(localStorage.getItem(`seenSurvey_${mockSurveys[0].id}`)).toBe('true')

        // now we clear the DOM to imitate a new page load and call surveys again, and it should not show the survey
        document.getElementsByTagName('html')[0].innerHTML = ''
        callSurveys(mockPostHog, false)
        expect(document.getElementsByClassName(`PostHogSurvey${mockSurveys[0].id}`)[0]).toBe(undefined)
        // no additional capture events are called because the survey is not shown
        expect(mockPostHog.capture).toBeCalledTimes(2)
    })

    test('does not show survey to user if they have seen it before and survey wait period is set', () => {
        mockSurveys = [
            {
                id: 'testSurvey2',
                name: 'Test survey 2',
                appearance: null,
                conditions: { seenSurveyWaitPeriodInDays: 10 },
                questions: [
                    {
                        question: 'How was your experience?',
                        description: 'This is a question description',
                        type: 'rating',
                        display: 'emoji',
                        scale: 5,
                        lowerBoundLabel: 'Not Good',
                        upperBoundLabel: 'Very Good',
                    },
                ],
            },
        ]
        expect(mockSurveys[0].conditions.seenSurveyWaitPeriodInDays).toBe(10)
        expect(localStorage.getItem(`seenSurvey_${mockSurveys[0].id}`)).toBe(null)
        callSurveys(mockPostHog, false)
        expect(mockPostHog.capture).toBeCalledTimes(1)
        expect(mockPostHog.capture).toBeCalledWith('survey shown', {
            $survey_id: 'testSurvey2',
            $survey_name: 'Test survey 2',
            sessionRecordingUrl: undefined,
        })
        expect(localStorage.getItem('lastSeenSurveyDate').split('T')[0]).toBe(new Date().toISOString().split('T')[0])

        document.getElementsByTagName('html')[0].innerHTML = ''
        callSurveys(mockPostHog, false)
        expect(document.getElementsByClassName(`PostHogSurvey${mockSurveys[0].id}`)[0]).toBe(undefined)
        // no additional capture events are called because the survey is not shown
        expect(mockPostHog.capture).toBeCalledTimes(1)
    })

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

    test('multiple choice type question elements are unique', () => {
        mockSurveys = [
            {
                id: 'testSurvey2',
                name: 'Test survey 2',
                appearance: null,
                conditions: { seenSurveyWaitPeriodInDays: 10 },
                questions: [
                    {
                        question: 'Which types of content would you like to see more of?',
                        description: 'This is a question description',
                        type: 'multiple_choice',
                        choices: ['Tutorials', 'Product Updates', 'Events', 'Other'],
                    },
                    {
                        question: 'Which features do you use the most?',
                        description: 'This is a question description',
                        type: 'multiple_choice',
                        choices: ['Surveys', 'Feature flags', 'Analytics'],
                    },
                ],
            },
        ]
        const multipleQuestionSurveyForm = createMultipleQuestionSurvey(mockPostHog, mockSurveys[0])
        const allSelectOptions = multipleQuestionSurveyForm.querySelectorAll('input[type=checkbox]')
        const uniqueIds = new Set()
        allSelectOptions.forEach((element) => {
            uniqueIds.add(element.id)
        })
        expect(uniqueIds.size).toBe(allSelectOptions.length)
    })

    test('single choice question type radio input elements are grouped correctly by question index', () => {
        mockSurveys = [
            {
                id: 'testSurvey2',
                name: 'Test survey 2',
                appearance: null,
                questions: [
                    {
                        question: 'Which types of content would you like to see more of?',
                        description: 'This is a question description',
                        type: 'single_choice',
                        choices: ['Tutorials', 'Product Updates', 'Events', 'Other'],
                    },
                    {
                        question: 'Which features do you use the most?',
                        description: 'This is a question description',
                        type: 'single_choice',
                        choices: ['Surveys', 'Feature flags', 'Analytics'],
                    },
                ],
            },
        ]
        const multipleQuestionSurveyForm = createMultipleQuestionSurvey(mockPostHog, mockSurveys[0])
        const firstQuestionRadioInputs = multipleQuestionSurveyForm
            .querySelectorAll('.tab.question-0')[0]
            .querySelectorAll('input[type=radio]')
        const mappedInputNames1 = [...firstQuestionRadioInputs].map((input) => input.name)
        expect(mappedInputNames1.every((name) => name === 'question0')).toBe(true)
        const secondQuestionRadioInputs = multipleQuestionSurveyForm
            .querySelectorAll('.tab.question-1')[0]
            .querySelectorAll('input[type=radio]')
        const mappedInputNames2 = [...secondQuestionRadioInputs].map((input) => input.name)
        expect(mappedInputNames2.every((name) => name === 'question1')).toBe(true)
    })

    test('rating questions that are on the 10 scale start at 0', () => {
        mockSurveys = [
            {
                id: 'testSurvey2',
                name: 'Test survey 2',
                appearance: null,
                questions: [
                    {
                        question: 'How satisfied are you with our newest product?',
                        description: 'This is a question description',
                        type: 'rating',
                        display: 'number',
                        scale: 10,
                        lowerBoundLabel: 'Not Satisfied',
                        upperBoundLabel: 'Very Satisfied',
                    },
                ],
            },
            {
                id: 'testSurvey3',
                name: 'Test survey 3',
                appearance: null,
                questions: [
                    {
                        question: 'How satisfied are you with our newest product?',
                        description: 'This is a question description',
                        type: 'rating',
                        display: 'emoji',
                        scale: 3,
                        lowerBoundLabel: 'Not Satisfied',
                        upperBoundLabel: 'Very Satisfied',
                    },
                ],
            },
        ]
        const ratingQuestion = createRatingsPopup(mockPostHog, mockSurveys[0], mockSurveys[0].questions[0], 0)
        expect(ratingQuestion.querySelectorAll('.question-0-rating-0').length).toBe(1)

        // expect the first value of the rating buttons to be 1 for other scales
        const ratingQuestion2 = createRatingsPopup(mockPostHog, mockSurveys[1], mockSurveys[1].questions[0], 0)
        expect(ratingQuestion2.querySelectorAll('.question-0-rating-0').length).toBe(0)
        expect(ratingQuestion2.querySelectorAll('.question-0-rating-1').length).toBe(1)
    })
})
