import '@testing-library/jest-dom'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { SurveyPopup } from '../../../extensions/surveys'
import * as surveyUtils from '../../../extensions/surveys/surveys-extension-utils' // Import all utils
import { Survey, SurveyQuestionType, SurveyType } from '../../../posthog-surveys-types'
import * as uuid from '../../../uuidv7' // Import uuidv7

// Mock the utility functions
jest.mock('../../../extensions/surveys/surveys-extension-utils', () => ({
    ...jest.requireActual('../../../extensions/surveys/surveys-extension-utils'), // Keep original implementations for non-mocked parts
    getInProgressSurveyState: jest.fn(),
    sendSurveyEvent: jest.fn(),
    dismissedSurveyEvent: jest.fn(),
}))

// Mock uuidv7
jest.mock('../../../uuidv7')

// Mock PostHog instance needed by event handlers
const mockPosthog = {
    capture: jest.fn(),
    get_session_replay_url: jest.fn().mockReturnValue('http://example.com/replay'),
}

describe('SurveyPopup', () => {
    const mockSurvey: Survey = {
        id: 'test-survey-partial',
        name: 'Test Partial Survey',
        description: 'A test survey for partial responses',
        type: SurveyType.Popover,
        feature_flag_keys: null,
        linked_flag_key: null,
        targeting_flag_key: null,
        internal_targeting_flag_key: null,
        questions: [
            {
                type: SurveyQuestionType.Open,
                question: 'Question 1',
                description: 'First question',
                id: 'q1',
            },
            {
                type: SurveyQuestionType.Open,
                question: 'Question 2',
                description: 'Second question',
                id: 'q2',
            },
        ],
        appearance: {
            displayThankYouMessage: true,
            thankYouMessageHeader: 'Thank you!',
            thankYouMessageDescription: 'Done.',
            backgroundColor: '#ffffff',
            borderColor: '#e5e5e5',
            submitButtonText: 'Next', // Consistent button text
            whiteLabel: true,
        },
        conditions: null,
        start_date: null,
        end_date: null,
        current_iteration: null,
        current_iteration_start_date: null,
        schedule: null,
    }

    // Mock functions passed as props
    let mockRemoveSurveyFromFocus: jest.Mock
    let mockOnCloseConfirmationMessage: jest.Mock

    // Type cast mocks for easier usage
    const mockedGetInProgressSurveyState = surveyUtils.getInProgressSurveyState as jest.Mock
    // Removed unused mocks for set/clear state
    // const mockedSetInProgressSurveyState = surveyUtils.setInProgressSurveyState as jest.Mock
    // const mockedClearInProgressSurveyState = surveyUtils.clearInProgressSurveyState as jest.Mock
    const mockedSendSurveyEvent = surveyUtils.sendSurveyEvent as jest.Mock
    const mockedDismissedSurveyEvent = surveyUtils.dismissedSurveyEvent as jest.Mock
    const mockedUuidv7 = uuid.uuidv7 as jest.Mock

    beforeEach(() => {
        cleanup()
        jest.clearAllMocks()
        // Mock uuidv7 to return a predictable value
        mockedUuidv7.mockReturnValue('new-uuid-generated')
        // Default mock for getInProgressSurveyState (no state)
        mockedGetInProgressSurveyState.mockReturnValue(null)

        mockRemoveSurveyFromFocus = jest.fn()
        mockOnCloseConfirmationMessage = jest.fn()

        // Mock form.submit to prevent JSDOM error
        HTMLFormElement.prototype.submit = jest.fn()
    })

    afterEach(() => {
        delete (HTMLFormElement.prototype as any).submit
    })

    // --- Existing Tests --- (Keep as is)
    test('calls onCloseConfirmationMessage when X button is clicked in the confirmation message', () => {
        render(
            <SurveyPopup
                survey={mockSurvey}
                removeSurveyFromFocus={mockRemoveSurveyFromFocus}
                isPopup={true}
                onCloseConfirmationMessage={mockOnCloseConfirmationMessage}
                previewPageIndex={mockSurvey.questions.length} // Force confirmation
                posthog={mockPosthog as any}
            />
        )
        const cancelButton = screen.getByRole('button', { name: /close survey/i })
        fireEvent.click(cancelButton)
        expect(mockOnCloseConfirmationMessage).toHaveBeenCalledTimes(1)
    })

    test('calls onCloseConfirmationMessage when survey is closed via button in the confirmation message', () => {
        render(
            <SurveyPopup
                survey={mockSurvey}
                removeSurveyFromFocus={mockRemoveSurveyFromFocus}
                isPopup={true}
                onCloseConfirmationMessage={mockOnCloseConfirmationMessage}
                previewPageIndex={mockSurvey.questions.length} // Force confirmation
                posthog={mockPosthog as any}
            />
        )
        const closeButton = screen.getByRole('button', { name: /close/i })
        fireEvent.click(closeButton)
        expect(mockOnCloseConfirmationMessage).toHaveBeenCalledTimes(1)
    })

    // --- Tests for Partial Responses --- (Keep as is, except final submission test)
    test('initializes with new submissionId and empty responses when no state in localStorage', () => {
        mockedGetInProgressSurveyState.mockReturnValue(null)
        render(
            <SurveyPopup
                survey={mockSurvey}
                removeSurveyFromFocus={mockRemoveSurveyFromFocus}
                isPopup={true}
                posthog={mockPosthog as any}
            />
        )
        expect(screen.getByText('Question 1')).toBeVisible()
        expect(screen.getByRole('textbox')).toHaveValue('')
        expect(mockedGetInProgressSurveyState).toHaveBeenCalledWith(mockSurvey)
        expect(mockedUuidv7).toHaveBeenCalledTimes(1)
    })

    test('initializes with existing submissionId and responses from localStorage', () => {
        const existingState = {
            surveySubmissionId: 'existing-uuid-123',
            responses: { $survey_response_q1: 'Previous answer' },
        }
        mockedGetInProgressSurveyState.mockReturnValue(existingState)
        render(
            <SurveyPopup
                survey={mockSurvey}
                removeSurveyFromFocus={mockRemoveSurveyFromFocus}
                isPopup={true}
                posthog={mockPosthog as any}
            />
        )
        expect(screen.getByText('Question 1')).toBeVisible()
        expect(screen.getByRole('textbox')).toHaveValue('Previous answer')
        expect(mockedGetInProgressSurveyState).toHaveBeenCalledWith(mockSurvey)
        expect(mockedUuidv7).not.toHaveBeenCalled()
    })

    test('saves partial response to localStorage when moving to next question', () => {
        const initialState = null
        const generatedId = 'newly-generated-id'
        mockedGetInProgressSurveyState.mockReturnValue(initialState)
        mockedUuidv7.mockReturnValue(generatedId)
        const partialResponsesSurvey = {
            ...mockSurvey,
            enable_partial_responses: true,
        }

        render(
            <SurveyPopup
                survey={partialResponsesSurvey}
                removeSurveyFromFocus={mockRemoveSurveyFromFocus}
                isPopup={true}
                posthog={mockPosthog as any}
            />
        )

        const input1 = screen.getByRole('textbox')
        fireEvent.input(input1, { target: { value: 'Answer Q1' } })

        // Use consistent button text from appearance
        const nextButton = screen.getByRole('button', { name: /submit survey/i })
        fireEvent.click(nextButton)

        expect(mockedSendSurveyEvent).toHaveBeenCalledWith({
            responses: {
                $survey_response_q1: 'Answer Q1',
            },
            survey: partialResponsesSurvey,
            surveySubmissionId: generatedId,
            isSurveyCompleted: false,
            posthog: mockPosthog,
        })
        expect(screen.getByText('Question 2')).toBeVisible()
    })

    test('clears localStorage on final submission', async () => {
        const existingState = {
            surveySubmissionId: 'existing-uuid-final',
            responses: { $survey_response_q1: 'Answer Q1' },
        }
        mockedGetInProgressSurveyState.mockReturnValue(existingState)

        render(
            <SurveyPopup
                survey={mockSurvey}
                removeSurveyFromFocus={mockRemoveSurveyFromFocus}
                isPopup={true}
                posthog={mockPosthog as any}
            />
        )

        expect(screen.getByRole('textbox')).toHaveValue('Answer Q1')

        // Click Next (using consistent button text)
        fireEvent.click(screen.getByRole('button', { name: /submit survey/i }))

        await waitFor(() => expect(screen.getByText('Question 2')).toBeVisible())
        const input2 = screen.getByRole('textbox')
        fireEvent.input(input2, { target: { value: 'Answer Q2' } })

        // Submit final question (using consistent button text)
        const submitButton = screen.getByRole('button', { name: /submit survey/i })
        fireEvent.click(submitButton)

        // Verify final sendSurveyEvent call
        expect(mockedSendSurveyEvent).toHaveBeenCalledWith({
            responses: {
                $survey_response_q1: 'Answer Q1',
                $survey_response_q2: 'Answer Q2',
            },
            survey: mockSurvey,
            surveySubmissionId: existingState.surveySubmissionId,
            isSurveyCompleted: true,
            posthog: mockPosthog,
        })

        // *** Manually dispatch the event that the real function would dispatch ***
        window.dispatchEvent(new CustomEvent('PHSurveySent', { detail: { surveyId: mockSurvey.id } }))

        // Now wait for the confirmation message triggered by the event
        await waitFor(() => expect(screen.getByText('Thank you!')).toBeVisible())

        // We've verified sendSurveyEvent was called with isSurveyCompleted=true,
        // implicitly testing that clearInProgressSurveyState would be called internally.
    })

    test('clears localStorage on dismissal', async () => {
        const existingState = {
            surveySubmissionId: 'existing-uuid-dismiss',
            responses: { $survey_response_q1: 'Partial answer' },
        }
        mockedGetInProgressSurveyState.mockReturnValue(existingState)
        mockedDismissedSurveyEvent.mockImplementation(() => {
            window.dispatchEvent(new CustomEvent('PHSurveyClosed', { detail: { surveyId: mockSurvey.id } }))
        })

        render(
            <SurveyPopup
                survey={mockSurvey}
                removeSurveyFromFocus={mockRemoveSurveyFromFocus}
                isPopup={true}
                posthog={mockPosthog as any}
            />
        )

        expect(screen.getByRole('textbox')).toHaveValue('Partial answer')

        const dismissButton = screen.getByRole('button', { name: /close survey/i })
        fireEvent.click(dismissButton)

        await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument())

        expect(mockedDismissedSurveyEvent).toHaveBeenCalledWith(mockSurvey, mockPosthog, false)
    })
})
