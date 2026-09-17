// @vitest-environment jsdom
import '../helpers/surveys-setup'
import type { Mock, MockInstance } from 'vitest'
import { createSurveysRuntimeHost } from '../helpers/surveys-runtime-host'

import '@testing-library/jest-dom'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { SurveyPopup } from '../../src/surveys-renderer'
import * as surveyUtils from '../../src/surveys/surveys-extension-utils'
import { SurveyQuestionBranchingType, SurveyQuestionType, SurveyType } from '../../src/survey-constants'
import type { Survey, SurveyQuestion } from '../../src/types/surveys'
import * as uuid from '../../src/utils/uuidv7'

vi.mock('../../src/surveys/surveys-extension-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/surveys/surveys-extension-utils')>()),
    getInProgressSurveyState: vi.fn(),
    setInProgressSurveyState: vi.fn(),
    sendSurveyEvent: vi.fn(),
    dismissedSurveyEvent: vi.fn(),
}))

vi.mock('../../src/utils/uuidv7')

const mockedSendSurveyEvent = surveyUtils.sendSurveyEvent as Mock
const mockedGetInProgressSurveyState = surveyUtils.getInProgressSurveyState as Mock
const mockedUuidv7 = uuid.uuidv7 as Mock

const host = createSurveysRuntimeHost({
    capture: vi.fn(),
    getReplayUrl: vi.fn().mockReturnValue('http://example.com/replay'),
    canCapture: true,
    reloadFlags: vi.fn(),
})

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
    let randomSpy: MockInstance

    beforeEach(() => {
        cleanup()
        vi.clearAllMocks()
        mockedUuidv7.mockReturnValue('generated-uuid')
        mockedGetInProgressSurveyState.mockReturnValue(null)
        HTMLFormElement.prototype.submit = vi.fn()

        // Keep q3 in place, then swap q1 and q2 with Fisher-Yates.
        randomSpy = vi.spyOn(Math, 'random').mockReturnValueOnce(0.999999).mockReturnValueOnce(0).mockReturnValue(0)
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

        render(<SurveyPopup survey={survey} removeSurveyFromFocus={vi.fn()} isPopup posthog={host as any} />)

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

        render(<SurveyPopup survey={survey} removeSurveyFromFocus={vi.fn()} isPopup posthog={host as any} />)

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

        render(<SurveyPopup survey={survey} removeSurveyFromFocus={vi.fn()} isPopup posthog={host as any} />)

        expect(screen.getByText('Question 1')).toBeVisible()
        answerCurrentQuestion()

        await waitFor(() => expect(screen.getByText('Question 2')).toBeVisible())
        answerCurrentQuestion()

        await waitFor(() =>
            expect(mockedSendSurveyEvent).toHaveBeenCalledWith(expect.objectContaining({ isSurveyCompleted: true }))
        )
    })
})
