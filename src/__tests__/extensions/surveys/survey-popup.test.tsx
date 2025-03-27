import '@testing-library/jest-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { SurveyPopup } from '../../../extensions/surveys'
import { Survey, SurveyQuestionType, SurveyType } from '../../../posthog-surveys-types'

describe('SurveyPopup', () => {
    // Create a basic mock survey for testing
    const mockSurvey: Survey = {
        id: 'test-survey',
        name: 'Test Survey',
        description: 'A test survey',
        type: SurveyType.Popover,
        feature_flag_keys: null,
        linked_flag_key: null,
        targeting_flag_key: null,
        internal_targeting_flag_key: null,
        questions: [
            {
                type: SurveyQuestionType.Open,
                question: 'Test question',
                description: 'Test description',
                id: 'q1',
            },
        ],
        appearance: {
            displayThankYouMessage: true,
            thankYouMessageHeader: 'Thank you for your feedback!',
            thankYouMessageDescription: 'We appreciate your input.',
            backgroundColor: '#ffffff',
            borderColor: '#e5e5e5',
            thankYouMessageCloseButtonText: 'Close',
            whiteLabel: true,
        },
        conditions: null,
        start_date: null,
        end_date: null,
        current_iteration: null,
        current_iteration_start_date: null,
        schedule: null,
    }

    beforeEach(() => {
        // Reset DOM
        cleanup()
        localStorage.clear()
        jest.clearAllMocks()
    })

    test('calls onCloseConfirmationMessage when X button is clicked in the confirmation message', () => {
        // Create a mock function to test if it gets called
        const mockOnCloseConfirmationMessage = jest.fn()
        const mockRemoveSurveyFromFocus = jest.fn()
        render(
            <SurveyPopup
                survey={mockSurvey}
                removeSurveyFromFocus={mockRemoveSurveyFromFocus}
                isPopup={true}
                onCloseConfirmationMessage={mockOnCloseConfirmationMessage}
                // Force the confirmation message to show
                previewPageIndex={mockSurvey.questions.length}
            />
        )
        const cancelButton2 = screen.getByRole('button', { name: 'Close survey', hidden: true })
        // Click the cancel button
        fireEvent.click(cancelButton2)
        // Verify that onCloseConfirmationMessage was called
        expect(mockOnCloseConfirmationMessage).toHaveBeenCalledTimes(1)
    })

    test('calls onCloseConfirmationMessage when survey is closed in the confirmation message', () => {
        const mockOnCloseConfirmationMessage = jest.fn()
        const mockRemoveSurveyFromFocus = jest.fn()
        render(
            <SurveyPopup
                survey={mockSurvey}
                removeSurveyFromFocus={mockRemoveSurveyFromFocus}
                isPopup={true}
                onCloseConfirmationMessage={mockOnCloseConfirmationMessage}
                previewPageIndex={mockSurvey.questions.length}
            />
        )

        const closeButton = screen.getByRole('button', { name: /close/i })
        fireEvent.click(closeButton)
        expect(mockOnCloseConfirmationMessage).toHaveBeenCalledTimes(1)
    })
})
