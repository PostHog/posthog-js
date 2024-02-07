import 'regenerator-runtime/runtime'
import { generateSurveys } from '../../extensions/surveys'
import { createShadow } from '../../extensions/surveys/surveys-utils'
import { SurveyType } from '../../posthog-surveys-types'

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
