import '@testing-library/jest-dom'
import { fireEvent, render } from '@testing-library/preact'
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
        document.getElementsByTagName('html')[0].innerHTML = ''
        localStorage.clear()
        jest.clearAllMocks()
    })

    test('calls onCloseConfirmationMessage when X button is clicked', () => {
        // Create a mock function to test if it gets called
        const mockOnCloseConfirmationMessage = jest.fn()
        const mockRemoveSurveyFromFocus = jest.fn()

        // Create a custom wrapper to set isSurveySent to true
        // This simulates the state after survey submission when confirmation message is shown
        const SurveyWrapper = () => {
            return (
                <SurveyPopup
                    survey={mockSurvey}
                    removeSurveyFromFocus={mockRemoveSurveyFromFocus}
                    isPopup={true}
                    onCloseConfirmationMessage={mockOnCloseConfirmationMessage}
                    // Force the confirmation message to show by providing props that match showConfirmation condition
                    // In the component: const shouldShowConfirmation = isSurveySent || previewPageIndex === survey.questions.length
                    previewPageIndex={mockSurvey.questions.length}
                />
            )
        }

        // Render the component
        const { container } = render(<SurveyWrapper />)

        // Find the X/Cancel button directly in the container
        const cancelButton = container.querySelector('button.form-cancel[aria-label="Close survey"]')

        // Click the cancel button
        if (cancelButton) {
            fireEvent.click(cancelButton)
            // Verify that onCloseConfirmationMessage was called
            expect(mockOnCloseConfirmationMessage).toHaveBeenCalledTimes(1)
        } else {
            expect(cancelButton).not.toBeNull() // Use expect instead of fail
        }
    })

    test('calls onCloseConfirmationMessage when Close button is clicked', () => {
        // Create a mock function to test if it gets called
        const mockOnCloseConfirmationMessage = jest.fn()
        const mockRemoveSurveyFromFocus = jest.fn()

        // Create a custom wrapper with confirmation message showing
        const SurveyWrapper = () => {
            return (
                <SurveyPopup
                    survey={mockSurvey}
                    removeSurveyFromFocus={mockRemoveSurveyFromFocus}
                    isPopup={true}
                    onCloseConfirmationMessage={mockOnCloseConfirmationMessage}
                    previewPageIndex={mockSurvey.questions.length}
                />
            )
        }

        // Render the component
        const { container } = render(<SurveyWrapper />)

        // Find the Close button directly in the container (rather than in Shadow DOM)
        const closeButton = container.querySelector('button.form-submit')

        // Click the Close button
        if (closeButton) {
            fireEvent.click(closeButton)
            // Verify that onCloseConfirmationMessage was called
            expect(mockOnCloseConfirmationMessage).toHaveBeenCalledTimes(1)
        } else {
            expect(closeButton).not.toBeNull() // Use expect instead of fail
        }
    })
})
