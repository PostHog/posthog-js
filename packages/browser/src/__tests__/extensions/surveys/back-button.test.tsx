import '@testing-library/jest-dom'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { SurveyPopup } from '../../../extensions/surveys'
import * as surveyUtils from '../../../extensions/surveys/surveys-extension-utils'
import { Survey, SurveyQuestionBranchingType, SurveyQuestionType, SurveyType } from '../../../posthog-surveys-types'
import * as uuid from '../../../uuidv7'

jest.mock('../../../extensions/surveys/surveys-extension-utils', () => ({
    ...jest.requireActual('../../../extensions/surveys/surveys-extension-utils'),
    getInProgressSurveyState: jest.fn(),
    setInProgressSurveyState: jest.fn(),
    sendSurveyEvent: jest.fn(),
    dismissedSurveyEvent: jest.fn(),
}))

const mockedSendSurveyEvent = surveyUtils.sendSurveyEvent as jest.Mock

jest.mock('../../../uuidv7')

const mockPosthog = {
    capture: jest.fn(),
    get_session_replay_url: jest.fn().mockReturnValue('http://example.com/replay'),
}

const baseSurvey: Survey = {
    id: 'back-survey',
    name: 'Back Survey',
    description: '',
    type: SurveyType.Popover,
    feature_flag_keys: null,
    linked_flag_key: null,
    targeting_flag_key: null,
    internal_targeting_flag_key: null,
    questions: [
        { type: SurveyQuestionType.Open, question: 'Question 1', id: 'q1' },
        { type: SurveyQuestionType.Open, question: 'Question 2', id: 'q2' },
        { type: SurveyQuestionType.Open, question: 'Question 3', id: 'q3' },
    ],
    appearance: {
        backgroundColor: '#ffffff',
        borderColor: '#e5e5e5',
        submitButtonText: 'Next',
        whiteLabel: true,
        allowGoBack: true,
    },
    conditions: null,
    start_date: null,
    end_date: null,
    current_iteration: null,
    current_iteration_start_date: null,
    schedule: null,
}

const mockedGetInProgressSurveyState = surveyUtils.getInProgressSurveyState as jest.Mock
const mockedSetInProgressSurveyState = surveyUtils.setInProgressSurveyState as jest.Mock
const mockedUuidv7 = uuid.uuidv7 as jest.Mock

describe('Surveys: back button', () => {
    beforeEach(() => {
        cleanup()
        jest.clearAllMocks()
        mockedUuidv7.mockReturnValue('generated-uuid')
        mockedGetInProgressSurveyState.mockReturnValue(null)
        HTMLFormElement.prototype.submit = jest.fn()
    })

    afterEach(() => {
        delete (HTMLFormElement.prototype as any).submit
    })

    test('back button is hidden on the first question', () => {
        render(
            <SurveyPopup survey={baseSurvey} removeSurveyFromFocus={jest.fn()} isPopup posthog={mockPosthog as any} />
        )

        expect(screen.getByText('Question 1')).toBeVisible()
        expect(screen.queryByRole('button', { name: /go to previous question/i })).not.toBeInTheDocument()
    })

    test('back button is hidden when allowGoBack is not set', async () => {
        const survey = { ...baseSurvey, appearance: { ...baseSurvey.appearance, allowGoBack: false } }
        render(<SurveyPopup survey={survey} removeSurveyFromFocus={jest.fn()} isPopup posthog={mockPosthog as any} />)

        fireEvent.input(screen.getByRole('textbox'), { target: { value: 'a' } })
        fireEvent.click(screen.getByRole('button', { name: /submit survey/i }))

        await waitFor(() => expect(screen.getByText('Question 2')).toBeVisible())
        expect(screen.queryByRole('button', { name: /go to previous question/i })).not.toBeInTheDocument()
    })

    test('back button appears after advancing and returns to the previous question with prior answer prefilled', async () => {
        render(
            <SurveyPopup survey={baseSurvey} removeSurveyFromFocus={jest.fn()} isPopup posthog={mockPosthog as any} />
        )

        fireEvent.input(screen.getByRole('textbox'), { target: { value: 'first answer' } })
        fireEvent.click(screen.getByRole('button', { name: /submit survey/i }))

        await waitFor(() => expect(screen.getByText('Question 2')).toBeVisible())
        const backButton = screen.getByRole('button', { name: /go to previous question/i })
        expect(backButton).toBeVisible()

        fireEvent.click(backButton)

        await waitFor(() => expect(screen.getByText('Question 1')).toBeVisible())
        expect(screen.getByRole('textbox')).toHaveValue('first answer')
        expect(screen.queryByRole('button', { name: /go to previous question/i })).not.toBeInTheDocument()
    })

    test('navigation history survives a re-render (resume from persisted state)', async () => {
        // First mount: advance Q1 -> Q2, capture whatever state the SDK persisted.
        const { unmount } = render(
            <SurveyPopup survey={baseSurvey} removeSurveyFromFocus={jest.fn()} isPopup posthog={mockPosthog as any} />
        )

        fireEvent.input(screen.getByRole('textbox'), { target: { value: 'first answer' } })
        fireEvent.click(screen.getByRole('button', { name: /submit survey/i }))
        await waitFor(() => expect(screen.getByText('Question 2')).toBeVisible())

        const persistedState = mockedSetInProgressSurveyState.mock.calls.at(-1)![1]
        unmount()

        // Second mount: feed the captured state back in (simulating a reload).
        mockedGetInProgressSurveyState.mockReturnValue(persistedState)
        render(
            <SurveyPopup survey={baseSurvey} removeSurveyFromFocus={jest.fn()} isPopup posthog={mockPosthog as any} />
        )

        // Behavior: we resume on Q2 AND the back button is available because Q1 is in history.
        expect(screen.getByText('Question 2')).toBeVisible()
        const backButton = screen.getByRole('button', { name: /go to previous question/i })
        fireEvent.click(backButton)

        await waitFor(() => expect(screen.getByText('Question 1')).toBeVisible())
        expect(screen.getByRole('textbox')).toHaveValue('first answer')
    })

    test('respects branching: back lands on the actual previous question, not currentIndex - 1', async () => {
        const branchedSurvey: Survey = {
            ...baseSurvey,
            questions: [
                {
                    type: SurveyQuestionType.Open,
                    question: 'Question 1',
                    id: 'q1',
                    branching: { type: SurveyQuestionBranchingType.SpecificQuestion, index: 2 },
                },
                { type: SurveyQuestionType.Open, question: 'Question 2', id: 'q2' },
                { type: SurveyQuestionType.Open, question: 'Question 3', id: 'q3' },
            ],
        }

        render(
            <SurveyPopup
                survey={branchedSurvey}
                removeSurveyFromFocus={jest.fn()}
                isPopup
                posthog={mockPosthog as any}
            />
        )

        fireEvent.input(screen.getByRole('textbox'), { target: { value: 'skip to q3' } })
        fireEvent.click(screen.getByRole('button', { name: /submit survey/i }))

        await waitFor(() => expect(screen.getByText('Question 3')).toBeVisible())
        fireEvent.click(screen.getByRole('button', { name: /go to previous question/i }))

        await waitFor(() => expect(screen.getByText('Question 1')).toBeVisible())
        expect(screen.queryByText('Question 2')).not.toBeInTheDocument()
    })

    test('resuming an in-progress survey without visitedIndices does not crash and hides back', () => {
        mockedGetInProgressSurveyState.mockReturnValue({
            surveySubmissionId: 'legacy-id',
            lastQuestionIndex: 1,
            responses: { $survey_response_q1: 'previous answer' },
        })

        render(
            <SurveyPopup survey={baseSurvey} removeSurveyFromFocus={jest.fn()} isPopup posthog={mockPosthog as any} />
        )

        expect(screen.getByText('Question 2')).toBeVisible()
        expect(screen.queryByRole('button', { name: /go to previous question/i })).not.toBeInTheDocument()
    })

    test('prunes responses from abandoned branches when path changes after backing up', async () => {
        const branchedSurvey: Survey = {
            ...baseSurvey,
            enable_partial_responses: true,
            questions: [
                {
                    type: SurveyQuestionType.SingleChoice,
                    question: 'Question 1',
                    id: 'q1',
                    choices: ['a', 'b'],
                    // choice index 0 ('a') -> Q2; choice index 1 ('b') -> Q3
                    branching: {
                        type: SurveyQuestionBranchingType.ResponseBased,
                        responseValues: { 0: 1, 1: 2 },
                    },
                } as any,
                { type: SurveyQuestionType.Open, question: 'Question 2', id: 'q2' },
                { type: SurveyQuestionType.Open, question: 'Question 3', id: 'q3' },
            ],
        }

        render(
            <SurveyPopup
                survey={branchedSurvey}
                removeSurveyFromFocus={jest.fn()}
                isPopup
                posthog={mockPosthog as any}
            />
        )

        // Q1: pick 'a' -> routes to Q2
        fireEvent.click(screen.getByLabelText('a'))
        fireEvent.click(screen.getByRole('button', { name: /submit survey/i }))
        await waitFor(() => expect(screen.getByText('Question 2')).toBeVisible())

        // Answer Q2, advance to Q3 so a response is recorded for q2.
        fireEvent.input(screen.getByRole('textbox'), { target: { value: 'q2 answer' } })
        fireEvent.click(screen.getByRole('button', { name: /submit survey/i }))
        await waitFor(() => expect(screen.getByText('Question 3')).toBeVisible())

        // Back twice to Q1.
        fireEvent.click(screen.getByRole('button', { name: /go to previous question/i }))
        await waitFor(() => expect(screen.getByText('Question 2')).toBeVisible())
        fireEvent.click(screen.getByRole('button', { name: /go to previous question/i }))
        await waitFor(() => expect(screen.getByText('Question 1')).toBeVisible())

        // Now switch answer to 'b' which routes to Q3 (skipping Q2 entirely).
        fireEvent.click(screen.getByLabelText('b'))
        mockedSendSurveyEvent.mockClear()
        fireEvent.click(screen.getByRole('button', { name: /submit survey/i }))
        await waitFor(() => expect(screen.getByText('Question 3')).toBeVisible())

        // The emitted responses should only contain Q1's answer — not the stale Q2 answer.
        const lastCall = mockedSendSurveyEvent.mock.calls.at(-1)![0]
        expect(lastCall.responses).toEqual({ $survey_response_q1: 'b' })
        expect(lastCall.responses).not.toHaveProperty('$survey_response_q2')
    })

    test('uses custom backButtonText from appearance', async () => {
        const survey = {
            ...baseSurvey,
            appearance: { ...baseSurvey.appearance, backButtonText: 'Previous' },
        }
        render(<SurveyPopup survey={survey} removeSurveyFromFocus={jest.fn()} isPopup posthog={mockPosthog as any} />)

        fireEvent.input(screen.getByRole('textbox'), { target: { value: 'a' } })
        fireEvent.click(screen.getByRole('button', { name: /submit survey/i }))

        await waitFor(() => expect(screen.getByText('Question 2')).toBeVisible())
        expect(screen.getByRole('button', { name: /go to previous question/i })).toHaveTextContent('Previous')
    })
})
