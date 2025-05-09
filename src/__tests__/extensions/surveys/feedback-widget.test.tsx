/* eslint-disable compat/compat */
import '@testing-library/jest-dom'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { FeedbackWidget } from '../../../extensions/surveys'
import { PostHog } from '../../../posthog-core' // Import PostHog type for mocking
import { Survey, SurveyQuestionType, SurveyType, SurveyWidgetType } from '../../../posthog-surveys-types'

// Mock PostHog instance
const mockPosthog = {
    capture: jest.fn(),
    getActiveMatchingSurveys: jest.fn(),
    featureFlags: {
        isFeatureEnabled: jest.fn().mockReturnValue(true),
    },
    get_session_replay_url: jest.fn().mockReturnValue('http://example.com/replay'),
} as unknown as PostHog

// Base mock survey for widget type
const baseWidgetSurvey: Survey = {
    id: 'widget-survey-123',
    name: 'Feedback Widget Survey',
    description: 'Test description',
    type: SurveyType.Widget,
    questions: [
        {
            type: SurveyQuestionType.Open,
            question: 'What is your feedback?',
            description: 'Please be specific.',
            id: 'q-open-1',
        },
    ],
    appearance: {
        widgetLabel: 'Feedback',
        widgetType: SurveyWidgetType.Tab,
        widgetColor: '#000000', // Black background
        backgroundColor: '#ffffff', // White popup background
        borderColor: '#e0e0e0',
        displayThankYouMessage: true,
        thankYouMessageHeader: 'Thanks!',
        thankYouMessageDescription: 'We got your feedback.',
        whiteLabel: false, // Assuming default
    },
    conditions: null,
    linked_flag_key: null,
    targeting_flag_key: null,
    internal_targeting_flag_key: null,
    start_date: '2023-01-01T00:00:00Z',
    end_date: null,
    current_iteration: null,
    current_iteration_start_date: null,
    schedule: null,
    feature_flag_keys: null,
}

// Mock survey with URL condition
const urlConditionWidgetSurvey: Survey = {
    ...baseWidgetSurvey,
    id: 'widget-survey-url',
    conditions: {
        url: 'http://test.com/specific-page',
        urlMatchType: 'exact',
        seenSurveyWaitPeriodInDays: null,
        events: null,
        actions: null,
    },
}

// Mock survey for selector type
const selectorWidgetSurvey: Survey = {
    ...baseWidgetSurvey,
    id: 'widget-survey-selector',
    appearance: {
        ...baseWidgetSurvey.appearance,
        widgetType: SurveyWidgetType.Selector,
        widgetSelector: '.my-custom-button',
    },
}

describe('FeedbackWidget', () => {
    let removeSurveyFromFocusMock: jest.Mock

    beforeEach(() => {
        cleanup()
        removeSurveyFromFocusMock = jest.fn()
        // Mock history API for URL change hook
        Object.defineProperty(window, 'history', {
            value: {
                pushState: jest.fn(),
                replaceState: jest.fn(),
                // Add scrollRestoration if needed by your code, JSDOM defaults to 'auto'
                scrollRestoration: 'manual',
            },
            writable: true,
        })

        // Mock form.submit to prevent JSDOM error
        HTMLFormElement.prototype.submit = jest.fn()

        jest.clearAllMocks()
    })

    afterEach(() => {
        // Restore form submit
        delete (HTMLFormElement.prototype as any).submit
    })

    const expectSurveyShowEvent = (surveyId: string) => {
        expect(mockPosthog.capture).toHaveBeenCalledWith(
            'survey shown',
            expect.objectContaining({ $survey_id: surveyId })
        )
    }

    const expectSurveySentEvent = (surveyId: string, response: Record<string, string>) => {
        expect(mockPosthog.capture).toHaveBeenLastCalledWith(
            'survey sent',
            expect.objectContaining({ $survey_id: surveyId, ...response })
        )
    }

    test('renders feedback tab and opens survey on click', () => {
        render(
            <FeedbackWidget
                survey={baseWidgetSurvey}
                posthog={mockPosthog}
                removeSurveyFromFocus={removeSurveyFromFocusMock}
            />
        )

        // Check if the tab is visible
        const tab = screen.getByText('Feedback')
        expect(tab).toBeVisible()

        // Survey popup should not be visible initially
        expect(screen.queryByRole('form')).not.toBeInTheDocument() // Form is inside SurveyPopup

        // Click the tab
        fireEvent.click(tab)

        // Survey popup should become visible
        expect(screen.getByRole('form')).toBeVisible()
        expect(screen.getByText('What is your feedback?')).toBeVisible()
    })

    test('submits survey response and shows thank you message', async () => {
        render(
            <FeedbackWidget
                survey={baseWidgetSurvey}
                posthog={mockPosthog}
                removeSurveyFromFocus={removeSurveyFromFocusMock}
            />
        )

        // Open the survey
        const tab = screen.getByText('Feedback')
        fireEvent.click(tab)

        expectSurveyShowEvent(baseWidgetSurvey.id)

        // Fill in the textarea
        const textarea = screen.getByRole('textbox')
        fireEvent.input(textarea, { target: { value: 'This is my feedback!' } })
        expect(textarea).toHaveValue('This is my feedback!')

        // Submit the form
        const submitButton = screen.getByRole('button', { name: /submit/i })
        fireEvent.click(submitButton)

        // Wait for survey sent event dispatch (internally) and UI update
        await waitFor(() => {
            // Check if thank you message is displayed
            expect(screen.getByText('Thanks!')).toBeVisible()
            expect(screen.getByText('We got your feedback.')).toBeVisible()
        })

        expectSurveySentEvent(baseWidgetSurvey.id, { '$survey_response_q-open-1': 'This is my feedback!' })

        // Form should be gone
        expect(screen.queryByRole('form')).not.toBeInTheDocument()

        // Close the thank you message
        const closeButton = screen.getByRole('button', { name: /close/i })
        fireEvent.click(closeButton)

        // Thank you message should disappear
        await waitFor(() => {
            expect(screen.queryByText('Thanks!')).not.toBeInTheDocument()
        })

        // Check if removeSurveyFromFocus was called (after submission shows thank you, it calls it internally)
        // This happens inside usePopupVisibility's handleSurveySent
        expect(removeSurveyFromFocusMock).toHaveBeenCalledWith(baseWidgetSurvey.id)
    })

    test('hides/shows feedback tab based on URL condition', async () => {
        // --- Start with a MATCHING URL ---
        Object.defineProperty(window, 'location', {
            value: { href: 'http://test.com/specific-page', pathname: '/specific-page', hash: '' },
            writable: true,
        })

        render(
            <FeedbackWidget
                survey={urlConditionWidgetSurvey}
                posthog={mockPosthog}
                removeSurveyFromFocus={removeSurveyFromFocusMock}
            />
        )

        // Initially, the tab should be visible because the URL matches
        expect(screen.getByText('Feedback')).toBeVisible()

        // --- Navigate to a NON-MATCHING URL ---
        Object.defineProperty(window, 'location', {
            value: { href: 'http://test.com/wrong-page', pathname: '/wrong-page', hash: '' },
            writable: true,
        })
        // Simulate the event that triggers the checkUrlMatch in the hook
        await act(async () => {
            fireEvent(window, new PopStateEvent('popstate'))
        })

        // Wait for the hook to run and hide the widget
        await waitFor(() => {
            expect(screen.queryByText('Feedback')).not.toBeInTheDocument()
        })

        // --- Navigate back to the MATCHING URL ---
        Object.defineProperty(window, 'location', {
            value: { href: 'http://test.com/specific-page', pathname: '/specific-page', hash: '' },
            writable: true,
        })
        // Simulate the event again
        await act(async () => {
            fireEvent(window, new PopStateEvent('popstate'))
        })

        // Now the widget should become visible again
        // Use waitFor as the state update might not be immediate
        await waitFor(() => {
            expect(screen.getByText('Feedback')).toBeVisible()
        })

        // --- Navigate Away Again ---
        Object.defineProperty(window, 'location', {
            value: { href: 'http://test.com/another-wrong-page', pathname: '/another-wrong-page', hash: '' },
            writable: true,
        })
        await act(async () => {
            fireEvent(window, new PopStateEvent('popstate'))
        })
        await waitFor(() => {
            expect(screen.queryByText('Feedback')).not.toBeInTheDocument()
        })
    })

    test('does not render tab for selector widget type initially', () => {
        render(
            <FeedbackWidget
                survey={selectorWidgetSurvey}
                posthog={mockPosthog}
                removeSurveyFromFocus={removeSurveyFromFocusMock}
            />
        )

        // Selector type should not render the tab or the form initially
        expect(screen.queryByText('Feedback')).not.toBeInTheDocument()
        // The survey form should also not be visible
        expect(screen.queryByRole('form')).not.toBeInTheDocument()
    })

    test('shows survey popup for selector widget when event is dispatched', async () => {
        render(
            <FeedbackWidget
                survey={selectorWidgetSurvey}
                posthog={mockPosthog}
                removeSurveyFromFocus={removeSurveyFromFocusMock}
            />
        )

        // Initially, no survey form
        expect(screen.queryByRole('form')).not.toBeInTheDocument()

        // Simulate the event dispatched by SurveyManager
        const event = new CustomEvent('ph:show_survey_widget', {
            detail: { surveyId: selectorWidgetSurvey.id, position: {} },
        })
        fireEvent(window, event)

        // Expect survey shown event after dispatching the event
        expectSurveyShowEvent(selectorWidgetSurvey.id)

        // Wait for the state update triggered by the event listener
        await waitFor(() => {
            // Survey popup should now be visible
            expect(screen.getByRole('form')).toBeVisible()
            expect(screen.getByText('What is your feedback?')).toBeVisible()
        })

        // Test submitting this one too
        const textarea = screen.getByRole('textbox')
        fireEvent.input(textarea, { target: { value: 'Selector feedback!' } })
        const submitButton = screen.getByRole('button', { name: /submit/i })
        fireEvent.click(submitButton)

        await waitFor(() => {
            expect(screen.getByText('Thanks!')).toBeVisible()
        })

        expectSurveySentEvent(selectorWidgetSurvey.id, { '$survey_response_q-open-1': 'Selector feedback!' })

        // Should be removed from focus after submission (handled internally by SurveyPopup -> usePopupVisibility)
        expect(removeSurveyFromFocusMock).toHaveBeenCalledWith(selectorWidgetSurvey.id)
    })

    test('closes survey popup when cancel button is clicked', async () => {
        render(
            <FeedbackWidget
                survey={baseWidgetSurvey}
                posthog={mockPosthog}
                removeSurveyFromFocus={removeSurveyFromFocusMock}
            />
        )

        // Open the survey
        fireEvent.click(screen.getByText('Feedback'))
        expect(screen.getByRole('form')).toBeVisible()

        // Find and click the cancel button (X) within the survey popup
        const cancelButton = screen.getByRole('button', { name: /close survey/i })
        fireEvent.click(cancelButton)

        // Wait for the popup to close (state update needs waitFor)
        await waitFor(() => {
            expect(screen.queryByRole('form')).not.toBeInTheDocument()
        })

        // Check if posthog.capture was called for 'survey dismissed'
        // Note: The dismissal event might happen *inside* SurveyPopup, not directly in FeedbackWidget.
        // The important part for *this* test is that the form disappears and removeSurveyFromFocus is called.
        // We can check the dismissed event in SurveyPopup tests if needed.
        // Let's verify removeSurveyFromFocus was called, as that's FeedbackWidget's responsibility via props.
        // SurveyPopup calls onPopupSurveyDismissed -> which calls removeSurveyFromFocus here
        expect(removeSurveyFromFocusMock).toHaveBeenCalledWith(baseWidgetSurvey.id)

        // Optionally, check for the dismiss event if it's guaranteed to be captured by this mock instance
        expect(mockPosthog.capture).toHaveBeenCalledWith(
            'survey dismissed',
            expect.objectContaining({
                $survey_id: baseWidgetSurvey.id,
            })
        )
    })
})
