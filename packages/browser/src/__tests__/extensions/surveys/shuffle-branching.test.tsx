import '@testing-library/jest-dom'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { SurveyPopup } from '../../../extensions/surveys'
import * as surveyUtils from '../../../extensions/surveys/surveys-extension-utils'
import {
    Survey,
    SurveyQuestion,
    SurveyQuestionBranchingType,
    SurveyQuestionType,
    SurveyType,
} from '../../../posthog-surveys-types'
import * as uuid from '@posthog/browser-common/utils/uuidv7'

vi.mock('../../../extensions/surveys/surveys-extension-utils', () => ({
    ...vi.requireActual('../../../extensions/surveys/surveys-extension-utils'),
    getInProgressSurveyState: vi.fn(),
    setInProgressSurveyState: vi.fn(),
    sendSurveyEvent: vi.fn(),
    dismissedSurveyEvent: vi.fn(),
}))

vi.mock('@posthog/browser-common/utils/uuidv7')

const mockedSendSurveyEvent = surveyUtils.sendSurveyEvent as vi.Mock
const mockedGetInProgressSurveyState = surveyUtils.getInProgressSurveyState as vi.Mock
const mockedUuidv7 = uuid.uuidv7 as vi.Mock

const mockPosthog = {
    capture: vi.fn(),
    get_session_replay_url: vi.fn().mockReturnValue('http://example.com/replay'),
    reloadFeatureFlags: vi.fn(),
}

const shuffledSurvey = (questions: SurveyQuestion[]): Survey =>
    ({
        id: 'shuffle-survey',
        name: 'Shuffle survey',
        description: '',
        type: SurveyType.Popover,
        feature_flag_keys: null,
        linked_flag_key: null,
        targeting_flag_key: null,
        internal_targeting_flag_key: null,
        questions,
        appearance: { submitButtonText: 'Next', whiteLabel: true, shuffleQuestions: true },
        conditions: null,
        start_date: null,
        end_date: null,
        current_iteration: null,
        current_iteration_start_date: null,
        schedule: null,
    }) as Survey

const openQuestion = (id: string, question: string): SurveyQuestion =>
    ({ type: SurveyQuestionType.Open, question, id }) as SurveyQuestion

describe('Surveys: shuffled questions', () => {
    let randomSpy: vi.SpyInstance

    beforeEach(() => {
        cleanup()
        vi.clearAllMocks()
        mockedUuidv7.mockReturnValue('generated-uuid')
        mockedGetInProgressSurveyState.mockReturnValue(null)
        HTMLFormElement.prototype.submit = vi.fn()

        // Sort keys 5, 1, 9 shuffle [q1, q2, q3] into [q2, q1, q3].
        randomSpy = vi
            .spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)
            .mockReturnValueOnce(0.1)
            .mockReturnValueOnce(0.9)
            .mockReturnValue(0)
    })

    afterEach(() => {
        randomSpy?.mockRestore()
        delete (HTMLFormElement.prototype as any).submit
    })

    const answerCurrentQuestion = () => {
        fireEvent.input(screen.getByRole('textbox'), { target: { value: 'an answer' } })
        fireEvent.click(screen.getByRole('button', { name: /submit survey/i }))
    }

    test('walks the shuffled order when no question has branching', async () => {
        const survey = shuffledSurvey([
            openQuestion('q1', 'Question 1'),
            openQuestion('q2', 'Question 2'),
            openQuestion('q3', 'Question 3'),
        ])

        render(<SurveyPopup survey={survey} removeSurveyFromFocus={vi.fn()} isPopup posthog={mockPosthog as any} />)

        expect(screen.getByText('Question 2')).toBeVisible()
        answerCurrentQuestion()

        await waitFor(() => expect(screen.getByText('Question 1')).toBeVisible())
        expect(mockedSendSurveyEvent).not.toHaveBeenCalled()
    })

    test('follows a specific-question branch to the configured target', async () => {
        const survey = shuffledSurvey([
            {
                ...openQuestion('q1', 'Question 1'),
                branching: { type: SurveyQuestionBranchingType.SpecificQuestion, index: 2 },
            },
            openQuestion('q2', 'Question 2'),
            openQuestion('q3', 'Question 3'),
        ])

        render(<SurveyPopup survey={survey} removeSurveyFromFocus={vi.fn()} isPopup posthog={mockPosthog as any} />)

        expect(screen.getByText('Question 1')).toBeVisible()
        answerCurrentQuestion()

        await waitFor(() => expect(screen.getByText('Question 3')).toBeVisible())
    })

    test('keeps the canonical order when a question has branching', async () => {
        const survey = shuffledSurvey([
            openQuestion('q1', 'Question 1'),
            { ...openQuestion('q2', 'Question 2'), branching: { type: SurveyQuestionBranchingType.End } },
            openQuestion('q3', 'Question 3'),
        ])

        render(<SurveyPopup survey={survey} removeSurveyFromFocus={vi.fn()} isPopup posthog={mockPosthog as any} />)

        expect(screen.getByText('Question 1')).toBeVisible()
        answerCurrentQuestion()

        await waitFor(() => expect(screen.getByText('Question 2')).toBeVisible())
        answerCurrentQuestion()

        await waitFor(() =>
            expect(mockedSendSurveyEvent).toHaveBeenCalledWith(expect.objectContaining({ isSurveyCompleted: true }))
        )
    })
})
