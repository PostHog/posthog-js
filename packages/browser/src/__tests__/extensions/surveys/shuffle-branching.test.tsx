import '@testing-library/jest-dom'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { SurveyPopup } from '../../../extensions/surveys'
import * as surveyUtils from '../../../extensions/surveys/surveys-extension-utils'
import { Survey, SurveyQuestionBranchingType, SurveyQuestionType, SurveyType } from '../../../posthog-surveys-types'
import * as uuid from '@posthog/browser-common/utils/uuidv7'

jest.mock('../../../extensions/surveys/surveys-extension-utils', () => ({
    ...jest.requireActual('../../../extensions/surveys/surveys-extension-utils'),
    getInProgressSurveyState: jest.fn(),
    setInProgressSurveyState: jest.fn(),
    sendSurveyEvent: jest.fn(),
    dismissedSurveyEvent: jest.fn(),
}))

jest.mock('@posthog/browser-common/utils/uuidv7')

const mockedSendSurveyEvent = surveyUtils.sendSurveyEvent as jest.Mock
const mockedGetInProgressSurveyState = surveyUtils.getInProgressSurveyState as jest.Mock
const mockedUuidv7 = uuid.uuidv7 as jest.Mock

const mockPosthog = {
    capture: jest.fn(),
    get_session_replay_url: jest.fn().mockReturnValue('http://example.com/replay'),
    reloadFeatureFlags: jest.fn(),
}

describe('Surveys: shuffled questions with branching', () => {
    let randomSpy: jest.SpyInstance

    beforeEach(() => {
        cleanup()
        jest.clearAllMocks()
        mockedUuidv7.mockReturnValue('generated-uuid')
        mockedGetInProgressSurveyState.mockReturnValue(null)
        HTMLFormElement.prototype.submit = jest.fn()
    })

    afterEach(() => {
        randomSpy?.mockRestore()
        delete (HTMLFormElement.prototype as any).submit
    })

    // The display order can differ from survey.questions when shuffleQuestions is on. Branching reads
    // and returns indices into survey.questions, so the displayed index must be translated both ways.
    // Without that translation, answering the first shown question evaluates the wrong question's
    // rules and can end the survey after a single answer.
    test('branches from the question the user answered, not the one at that display slot', async () => {
        // Drive the real shuffle to a known order: sort keys 5, 1, 9 for q1, q2, q3 produce the
        // display order [q2, q1, q3], so Question 2 is shown first. Its display index (0) then points
        // at Question 1's "End" branch in survey.questions.
        randomSpy = jest
            .spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)
            .mockReturnValueOnce(0.1)
            .mockReturnValueOnce(0.9)
            .mockReturnValue(0)

        const survey: Survey = {
            id: 'shuffle-branch-survey',
            name: 'Shuffle branch survey',
            description: '',
            type: SurveyType.Popover,
            feature_flag_keys: null,
            linked_flag_key: null,
            targeting_flag_key: null,
            internal_targeting_flag_key: null,
            questions: [
                {
                    type: SurveyQuestionType.Open,
                    question: 'Question 1',
                    id: 'q1',
                    branching: { type: SurveyQuestionBranchingType.End },
                },
                { type: SurveyQuestionType.Open, question: 'Question 2', id: 'q2' },
                { type: SurveyQuestionType.Open, question: 'Question 3', id: 'q3' },
            ],
            appearance: { submitButtonText: 'Next', whiteLabel: true, shuffleQuestions: true },
            conditions: null,
            start_date: null,
            end_date: null,
            current_iteration: null,
            current_iteration_start_date: null,
            schedule: null,
        }

        render(<SurveyPopup survey={survey} removeSurveyFromFocus={jest.fn()} isPopup posthog={mockPosthog as any} />)

        expect(screen.getByText('Question 2')).toBeVisible()

        fireEvent.input(screen.getByRole('textbox'), { target: { value: 'answer to question 2' } })
        fireEvent.click(screen.getByRole('button', { name: /submit survey/i }))

        // Question 2 has no branching, so it advances to Question 3 rather than ending the survey.
        await waitFor(() => expect(screen.getByText('Question 3')).toBeVisible())
        // Partial responses are off and the survey is not complete, so nothing is sent yet.
        expect(mockedSendSurveyEvent).not.toHaveBeenCalled()
    })
})
