import '@testing-library/jest-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { SurveyPopup } from '../../../extensions/surveys'
import { Survey, SurveyQuestionType, SurveyType } from '../../../posthog-surveys-types'

jest.mock('../../../extensions/surveys/surveys-extension-utils', () => ({
    ...jest.requireActual('../../../extensions/surveys/surveys-extension-utils'),
    sendSurveyEvent: jest.fn(),
    dismissedSurveyEvent: jest.fn(),
}))

const mockPosthog = {
    capture: jest.fn(),
    get_session_replay_url: jest.fn().mockReturnValue('http://example.com/replay'),
    reloadFeatureFlags: jest.fn(),
} as any

const survey = {
    id: 'resume-shuffled',
    name: 'Resume shuffled survey',
    description: '',
    type: SurveyType.Popover,
    feature_flag_keys: null,
    linked_flag_key: null,
    targeting_flag_key: null,
    internal_targeting_flag_key: null,
    questions: [
        { type: SurveyQuestionType.Open, question: 'Question 1', id: 'q0' },
        { type: SurveyQuestionType.Open, question: 'Question 2', id: 'q1' },
        { type: SurveyQuestionType.Open, question: 'Question 3', id: 'q2' },
    ],
    enable_partial_responses: false,
    appearance: { submitButtonText: 'Next', whiteLabel: true, shuffleQuestions: true },
    conditions: null,
    start_date: null,
    end_date: null,
    current_iteration: null,
    current_iteration_start_date: null,
    schedule: null,
} as unknown as Survey

// Sort keys drive shuffle(); the two orders below differ so a reshuffle on resume is detectable.
const shuffleTo = (a: number, b: number, c: number) =>
    jest.spyOn(Math, 'random').mockReturnValueOnce(a).mockReturnValueOnce(b).mockReturnValueOnce(c).mockReturnValue(0)

const currentQuestion = () => document.querySelector('.survey-question')?.textContent

const show = () =>
    render(<SurveyPopup survey={survey} removeSurveyFromFocus={jest.fn()} isPopup posthog={mockPosthog} />)

describe('Surveys: resuming a shuffled survey', () => {
    beforeEach(() => {
        cleanup()
        jest.clearAllMocks()
        localStorage.clear()
        HTMLFormElement.prototype.submit = jest.fn()
    })

    afterEach(() => jest.restoreAllMocks())

    test('resumes on the question the respondent left off on', () => {
        shuffleTo(0.5, 0.1, 0.9)
        const { unmount } = show()
        fireEvent.input(screen.getByRole('textbox'), { target: { value: 'an answer' } })
        fireEvent.click(screen.getByRole('button', { name: /submit survey/i }))
        const leftOffOn = currentQuestion()
        unmount()
        cleanup()
        jest.restoreAllMocks()

        shuffleTo(0.9, 0.5, 0.1)
        show()

        expect(currentQuestion()).toBe(leftOffOn)
    })

    test('keeps showing the remaining questions in the order the respondent started with', () => {
        shuffleTo(0.5, 0.1, 0.9)
        const { unmount } = show()
        const startingOrder = [currentQuestion()]
        fireEvent.input(screen.getByRole('textbox'), { target: { value: 'an answer' } })
        fireEvent.click(screen.getByRole('button', { name: /submit survey/i }))
        startingOrder.push(currentQuestion())
        unmount()
        cleanup()
        jest.restoreAllMocks()

        shuffleTo(0.9, 0.5, 0.1)
        show()
        fireEvent.input(screen.getByRole('textbox'), { target: { value: 'another answer' } })
        fireEvent.click(screen.getByRole('button', { name: /submit survey/i }))

        expect(startingOrder).not.toContain(currentQuestion())
    })
})
