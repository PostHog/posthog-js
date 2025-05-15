import '@testing-library/jest-dom'

import { fireEvent, render, screen } from '@testing-library/preact'
import {
    MultipleChoiceQuestion,
    OpenTextQuestion,
    RatingQuestion,
    parseUserPropertiesInLink,
} from '../../../extensions/surveys/components/QuestionTypes'
import {
    BasicSurveyQuestion,
    MultipleSurveyQuestion,
    RatingSurveyQuestion,
    SurveyQuestionType,
} from '../../../posthog-surveys-types'
import { PostHog } from '../../../posthog-core'
import { STORED_PERSON_PROPERTIES_KEY } from '../../../constants'

// Helper to create a mock PostHog instance for testing parseUserPropertiesInLink
const mockPostHog = (properties: Record<string, any> = {}): PostHog => {
    return {
        get_property: (key: string) => properties[key],
    } as PostHog
}

describe('parseUserPropertiesInLink', () => {
    it('should return the original link if no placeholders are present', () => {
        const link = 'https://example.com/page'
        expect(parseUserPropertiesInLink(link, mockPostHog())).toBe(link)
    })

    it('should replace placeholder with direct property value', () => {
        const ph = mockPostHog({ user_id: '123' })
        const link = 'https://example.com?id={{user_id}}'
        expect(parseUserPropertiesInLink(link, ph)).toBe('https://example.com?id=123')
    })

    it('should replace placeholder with stored person property if direct is not found', () => {
        const ph = mockPostHog({
            [STORED_PERSON_PROPERTIES_KEY]: { user_id: 'abc' },
        })
        const link = 'https://example.com?id={{user_id}}'
        expect(parseUserPropertiesInLink(link, ph)).toBe('https://example.com?id=abc')
    })

    it('should prioritize direct property over stored person property if direct is a valid string/number', () => {
        const ph = mockPostHog({
            user_id: 'direct_val',
            [STORED_PERSON_PROPERTIES_KEY]: { user_id: 'stored_val' },
        })
        const link = 'https://example.com?id={{user_id}}'
        expect(parseUserPropertiesInLink(link, ph)).toBe('https://example.com?id=direct_val')
    })

    it('should use stored person property if direct property is null', () => {
        const ph = mockPostHog({
            user_id: null,
            [STORED_PERSON_PROPERTIES_KEY]: { user_id: 'stored_val_for_null' },
        })
        const link = 'https://example.com?id={{user_id}}'
        expect(parseUserPropertiesInLink(link, ph)).toBe('https://example.com?id=stored_val_for_null')
    })

    it('should use stored person property if direct property is undefined', () => {
        const ph = mockPostHog({
            // user_id is undefined implicitly
            [STORED_PERSON_PROPERTIES_KEY]: { user_id: 'stored_val_for_undefined' },
        })
        const link = 'https://example.com?id={{user_id}}'
        expect(parseUserPropertiesInLink(link, ph)).toBe('https://example.com?id=stored_val_for_undefined')
    })

    it('should not replace placeholder if property not in direct or stored person properties', () => {
        const ph = mockPostHog({
            [STORED_PERSON_PROPERTIES_KEY]: { another_prop: 'val' },
        })
        const link = 'https://example.com?id={{non_existent_id}}'
        expect(parseUserPropertiesInLink(link, ph)).toBe(link)
    })

    it('should handle case where STORED_PERSON_PROPERTIES_KEY is not an object', () => {
        const ph = mockPostHog({
            [STORED_PERSON_PROPERTIES_KEY]: 'not_an_object',
        })
        const link = 'https://example.com?id={{user_id}}'
        expect(parseUserPropertiesInLink(link, ph)).toBe(link)
    })

    it('should handle case where STORED_PERSON_PROPERTIES_KEY does not exist', () => {
        const ph = mockPostHog({})
        const link = 'https://example.com?id={{user_id}}'
        expect(parseUserPropertiesInLink(link, ph)).toBe(link)
    })

    it('should trim whitespace for property names when checking stored person properties', () => {
        const ph = mockPostHog({
            [STORED_PERSON_PROPERTIES_KEY]: { user_id: 'trimmed_stored' },
        })
        const link = 'https://example.com?id={{ user_id }}'
        expect(parseUserPropertiesInLink(link, ph)).toBe('https://example.com?id=trimmed_stored')
    })

    it('should URL encode stored person property values', () => {
        const ph = mockPostHog({
            [STORED_PERSON_PROPERTIES_KEY]: { name: 'Stored User' },
        })
        const link = 'https://example.com?user={{name}}'
        expect(parseUserPropertiesInLink(link, ph)).toBe('https://example.com?user=Stored%20User')
    })

    // --- Retain and adapt previous tests to ensure they still pass with new logic, potentially adding stored properties --- //

    it('should replace a single {placeholder} with a string value (direct)', () => {
        const ph = mockPostHog({ user_id: '456' })
        const link = 'https://example.com?id={user_id}'
        expect(parseUserPropertiesInLink(link, ph)).toBe('https://example.com?id=456')
    })

    it('should replace a single {placeholder} with a string value (stored)', () => {
        const ph = mockPostHog({ [STORED_PERSON_PROPERTIES_KEY]: { user_id: '789' } })
        const link = 'https://example.com?id={user_id}'
        expect(parseUserPropertiesInLink(link, ph)).toBe('https://example.com?id=789')
    })

    it('should replace a placeholder with a number value (direct)', () => {
        const ph = mockPostHog({ score: 100 })
        const link = 'https://example.com?value={{score}}'
        expect(parseUserPropertiesInLink(link, ph)).toBe('https://example.com?value=100')
    })

    it('should replace a placeholder with a number value (stored)', () => {
        const ph = mockPostHog({ [STORED_PERSON_PROPERTIES_KEY]: { score: 200 } })
        const link = 'https://example.com?value={{score}}'
        expect(parseUserPropertiesInLink(link, ph)).toBe('https://example.com?value=200')
    })

    it('should replace multiple placeholders (mixed direct and stored)', () => {
        const ph = mockPostHog({
            user_id: 'abc',
            [STORED_PERSON_PROPERTIES_KEY]: { region: 'us_stored' },
        })
        const link = 'https://{region}.example.com/user/{{user_id}}'
        expect(parseUserPropertiesInLink(link, ph)).toBe('https://us_stored.example.com/user/abc')
    })

    it('should handle placeholders with special characters like $ (direct)', () => {
        const ph = mockPostHog({ $user_id: 'testUserDirect' })
        const link = 'https://example.com?id={{$user_id}}'
        expect(parseUserPropertiesInLink(link, ph)).toBe('https://example.com?id=testUserDirect')
    })

    it('should handle placeholders with special characters like $ (stored)', () => {
        const ph = mockPostHog({ [STORED_PERSON_PROPERTIES_KEY]: { $user_id: 'testUserStored' } })
        const link = 'https://example.com?id={{$user_id}}'
        expect(parseUserPropertiesInLink(link, ph)).toBe('https://example.com?id=testUserStored')
    })

    it('should trim whitespace from property names in placeholders {{ prop }} (direct)', () => {
        const ph = mockPostHog({ user_id: 'trimmed_direct' })
        const link = 'https://example.com?id={{ user_id }}'
        expect(parseUserPropertiesInLink(link, ph)).toBe('https://example.com?id=trimmed_direct')
    })

    it('should URL encode property values with spaces (direct)', () => {
        const ph = mockPostHog({ name: 'John Doe Direct' })
        const link = 'https://example.com?user={{name}}'
        expect(parseUserPropertiesInLink(link, ph)).toBe('https://example.com?user=John%20Doe%20Direct')
    })

    it('should URL encode property values that look like javascript URIs (stored)', () => {
        const ph = mockPostHog({ [STORED_PERSON_PROPERTIES_KEY]: { malicious_link: "javascript:alert('XSS_Stored')" } })
        const link = 'https://example.com?redirect={{malicious_link}}'
        expect(parseUserPropertiesInLink(link, ph)).toBe(
            "https://example.com?redirect=javascript%3Aalert('XSS_Stored')"
        )
    })

    it('should return the original link if posthog instance is undefined', () => {
        const link = 'https://example.com?id={{user_id}}'
        expect(parseUserPropertiesInLink(link, undefined)).toBe(link)
    })

    it('should return the original link if posthog.get_property is undefined', () => {
        const link = 'https://example.com?id={{user_id}}'
        expect(parseUserPropertiesInLink(link, {} as PostHog)).toBe(link)
    })

    it('should return an empty string if the link is empty', () => {
        expect(parseUserPropertiesInLink('', mockPostHog())).toBe('')
    })

    it('should handle a link that is only a placeholder (value URL encoded, from stored)', () => {
        const ph = mockPostHog({
            [STORED_PERSON_PROPERTIES_KEY]: { homepage: 'index.html?greeting=hello stored world' },
        })
        expect(parseUserPropertiesInLink('{{homepage}}', ph)).toBe('index.html%3Fgreeting%3Dhello%20stored%20world')
    })

    it('should not replace placeholders if property value is an object (in both direct and stored)', () => {
        const ph = mockPostHog({
            user_data: { id: 1 },
            [STORED_PERSON_PROPERTIES_KEY]: { user_data_stored: { id: 2 } },
        })
        const link = 'https://example.com?data={{user_data}}&stored_data={{user_data_stored}}'
        expect(parseUserPropertiesInLink(link, ph)).toBe(
            'https://example.com?data={{user_data}}&stored_data={{user_data_stored}}'
        )
    })

    it('should not replace placeholders if property value is null (and not in stored or stored is also null)', () => {
        const ph = mockPostHog({
            user_name: null,
            [STORED_PERSON_PROPERTIES_KEY]: { user_name_also_null: null },
        })
        const link = 'https://example.com?name={{user_name}}&other_name={{user_name_also_null}}'
        expect(parseUserPropertiesInLink(link, ph)).toBe(link)
    })

    it('should handle empty property names within placeholders like {{ }} or {} after trimming (checking stored)', () => {
        const phWithEmptyKeyStored = mockPostHog({ [STORED_PERSON_PROPERTIES_KEY]: { '': 'emptyStoredPropValue' } })
        const linkWithSpacedEmpty = 'https://example.com?a={{  }}&b={ }'
        expect(parseUserPropertiesInLink(linkWithSpacedEmpty, phWithEmptyKeyStored)).toBe(
            'https://example.com?a=emptyStoredPropValue&b=emptyStoredPropValue'
        )

        // Truly empty placeholders {{}} should still not be replaced as per previous logic
        const linkWithTrueEmpty = 'https://example.com?a={{}}&b={}'
        expect(parseUserPropertiesInLink(linkWithTrueEmpty, phWithEmptyKeyStored)).toBe(linkWithTrueEmpty)
    })
})

describe('MultipleChoiceQuestion', () => {
    const mockAppearance = {
        backgroundColor: '#fff',
        submitButtonText: 'Submit',
        ratingButtonColor: '#000',
        ratingButtonActiveColor: '#fff',
        borderColor: '#000',
    }

    const baseProps = {
        forceDisableHtml: false,
        appearance: mockAppearance,
        displayQuestionIndex: 1,
        onSubmit: jest.fn(),
        onPreviewSubmit: jest.fn(),
    }

    describe('SingleChoice', () => {
        const singleChoiceQuestion: MultipleSurveyQuestion = {
            type: SurveyQuestionType.SingleChoice,
            question: 'What is your favorite color?',
            description: 'Choose one color',
            choices: ['Red', 'Blue', 'Green', 'Other'],
            hasOpenChoice: true,
            optional: false,
        }

        it('submits the selected choice correctly', () => {
            const { getByLabelText, getByText } = render(
                <MultipleChoiceQuestion {...baseProps} question={singleChoiceQuestion} />
            )

            // Click on 'Blue' option
            fireEvent.click(getByLabelText('Blue'))

            // Click submit
            fireEvent.click(getByText('Submit'))

            expect(baseProps.onSubmit).toHaveBeenCalledWith('Blue')
        })

        it('submits open-ended choice correctly', () => {
            const { getByText, container } = render(
                <MultipleChoiceQuestion {...baseProps} question={singleChoiceQuestion} />
            )

            // Click on 'Other' option using the radio input id
            const otherRadio = container.querySelector('#surveyQuestion1Choice3') as HTMLInputElement
            fireEvent.click(otherRadio)

            // Type in the open-ended input using its specific id
            const openInput = container.querySelector('#surveyQuestion1Choice3Open') as HTMLInputElement
            fireEvent.input(openInput, { target: { value: 'Purple' } })

            // Click submit
            fireEvent.click(getByText('Submit'))

            expect(baseProps.onSubmit).toHaveBeenCalledWith('Purple')
        })

        it('focuses on open-ended input when selecting the option', () => {
            const { container } = render(<MultipleChoiceQuestion {...baseProps} question={singleChoiceQuestion} />)

            // Click on 'Other' option using the radio input id
            const otherRadio = container.querySelector('#surveyQuestion1Choice3') as HTMLInputElement
            fireEvent.click(otherRadio)

            // Get the input element using its specific id
            const openInput = container.querySelector('#surveyQuestion1Choice3Open') as HTMLInputElement

            // Use a small timeout to allow for the focus to be set
            setTimeout(() => {
                expect(document.activeElement).toBe(openInput)
            }, 0)
        })
    })

    describe('MultipleChoice', () => {
        const multipleChoiceQuestion: MultipleSurveyQuestion = {
            type: SurveyQuestionType.MultipleChoice,
            question: 'What colors do you like?',
            description: 'Choose multiple colors',
            choices: ['Red', 'Blue', 'Green', 'Other'],
            hasOpenChoice: true,
            optional: false,
        }

        it('submits multiple selected choices correctly', () => {
            const { getByLabelText, getByText } = render(
                <MultipleChoiceQuestion {...baseProps} question={multipleChoiceQuestion} />
            )

            // Click on multiple options
            fireEvent.click(getByLabelText('Red'))
            fireEvent.click(getByLabelText('Blue'))

            // Click submit
            fireEvent.click(getByText('Submit'))

            expect(baseProps.onSubmit).toHaveBeenCalledWith(['Red', 'Blue'])
        })

        it('submits multiple choices with open-ended choice correctly', () => {
            const { getByLabelText, getByText, container } = render(
                <MultipleChoiceQuestion {...baseProps} question={multipleChoiceQuestion} />
            )

            // Click on a regular option
            fireEvent.click(getByLabelText('Red'))

            // Click on 'Other' option using the radio input id
            const otherRadio = container.querySelector('#surveyQuestion1Choice3') as HTMLInputElement
            fireEvent.click(otherRadio)

            // Type in the open-ended input using its specific id
            const openInput = container.querySelector('#surveyQuestion1Choice3Open') as HTMLInputElement
            fireEvent.input(openInput, { target: { value: 'Purple' } })

            // Click submit
            fireEvent.click(getByText('Submit'))

            expect(baseProps.onSubmit).toHaveBeenCalledWith(['Red', 'Purple'])
        })

        it('focuses on open-ended input when selecting the option', () => {
            const { container } = render(<MultipleChoiceQuestion {...baseProps} question={multipleChoiceQuestion} />)

            // Click on 'Other' option using the radio input id
            const otherRadio = container.querySelector('#surveyQuestion1Choice3') as HTMLInputElement
            fireEvent.click(otherRadio)

            // Get the input element using its specific id
            const openInput = container.querySelector('#surveyQuestion1Choice3Open') as HTMLInputElement

            // Use a small timeout to allow for the focus to be set
            setTimeout(() => {
                expect(document.activeElement).toBe(openInput)
            }, 0)
        })

        it('does not propagate keydown events from open choice input', () => {
            const parentKeyDownHandler = jest.fn()
            const { container } = render(
                <div onKeyDown={parentKeyDownHandler}>
                    <MultipleChoiceQuestion {...baseProps} question={multipleChoiceQuestion} />
                </div>
            )

            // Find the open-ended input using its specific ID
            const openInput = container.querySelector('#surveyQuestion1Choice3Open') as HTMLInputElement
            if (!openInput) {
                throw new Error('Open choice input not found')
            }

            // Simulate typing 'C' into the open-ended input
            fireEvent.keyDown(openInput, { key: 'C', code: 'KeyC' })

            // Assert that the parent's keydown handler was NOT called
            expect(parentKeyDownHandler).not.toHaveBeenCalled()
        })
    })
})

describe('OpenTextQuestion', () => {
    const mockAppearance = {
        backgroundColor: '#fff',
        submitButtonText: 'Submit',
        placeholder: 'Enter your response',
    }

    const baseProps = {
        forceDisableHtml: false,
        appearance: mockAppearance,
        onSubmit: jest.fn(),
        onPreviewSubmit: jest.fn(),
    }

    const openTextQuestion: BasicSurveyQuestion = {
        type: SurveyQuestionType.Open,
        question: 'What is your feedback?',
        description: 'Provide details below',
        optional: false,
    }

    it('does not propagate keydown events', () => {
        const parentKeyDownHandler = jest.fn()

        // Render the component within a div that has a keydown listener
        const { container } = render(
            <div onKeyDown={parentKeyDownHandler}>
                <OpenTextQuestion {...baseProps} question={openTextQuestion} />
            </div>
        )

        const textarea = container.querySelector('textarea')

        if (!textarea) {
            throw new Error('Textarea not found')
        }

        // Simulate typing 'C' into the textarea
        fireEvent.keyDown(textarea, { key: 'C', code: 'KeyC' })

        // Assert that the parent's keydown handler was NOT called
        expect(parentKeyDownHandler).not.toHaveBeenCalled()
    })

    // Add other tests for OpenTextQuestion if needed...
})

describe('RatingQuestion', () => {
    const mockAppearance = {
        backgroundColor: '#fff',
        submitButtonText: 'Submit',
        ratingButtonColor: '#ccc',
        ratingButtonActiveColor: '#007bff',
        borderColor: '#ddd',
    }

    const baseProps = {
        forceDisableHtml: false,
        appearance: mockAppearance,
        displayQuestionIndex: 1,
        onSubmit: jest.fn(),
        onPreviewSubmit: jest.fn(),
    }

    const ratingQuestion: RatingSurveyQuestion = {
        type: SurveyQuestionType.Rating,
        question: 'How would you rate your experience?',
        description: 'Scale from 1 to 5',
        display: 'number',
        scale: 5,
        lowerBoundLabel: 'Bad',
        upperBoundLabel: 'Good',
        optional: false,
    }

    const getRatingButton = (value: number) => {
        return screen.getByText(value.toString())
    }

    it('renders correctly with no initial value', () => {
        render(<RatingQuestion {...baseProps} question={ratingQuestion} initialValue={null} />)
        const buttons = screen.getAllByRole('button')
        const ratingButtons = buttons.filter((btn) => btn.textContent !== mockAppearance.submitButtonText)
        ratingButtons.forEach((button) => {
            expect(button).not.toHaveClass('rating-active')
        })
    })

    it('renders correctly with a valid numeric initial value', () => {
        render(<RatingQuestion {...baseProps} question={ratingQuestion} initialValue={3} />)
        const button3 = getRatingButton(3)
        expect(button3).toHaveClass('rating-active')
    })

    it('renders correctly with a valid string initial value', () => {
        render(<RatingQuestion {...baseProps} question={ratingQuestion} initialValue={'4'} />)
        const button4 = getRatingButton(4)
        expect(button4).toHaveClass('rating-active')
    })

    it('renders correctly with a valid array initial value', () => {
        render(<RatingQuestion {...baseProps} question={ratingQuestion} initialValue={['2']} />)
        const button2 = getRatingButton(2)
        expect(button2).toHaveClass('rating-active')
    })

    it('renders correctly with an invalid string initial value', () => {
        render(<RatingQuestion {...baseProps} question={ratingQuestion} initialValue={'invalid'} />)
        const buttons = screen.getAllByRole('button')
        const ratingButtons = buttons.filter((btn) => btn.textContent !== mockAppearance.submitButtonText)
        ratingButtons.forEach((button) => {
            expect(button).not.toHaveClass('rating-active')
        })
    })

    it('renders correctly with an empty array initial value', () => {
        render(<RatingQuestion {...baseProps} question={ratingQuestion} initialValue={[]} />)
        const buttons = screen.getAllByRole('button')
        const ratingButtons = buttons.filter((btn) => btn.textContent !== mockAppearance.submitButtonText)
        ratingButtons.forEach((button) => {
            expect(button).not.toHaveClass('rating-active')
        })
    })

    it('renders correctly with an array containing an invalid string', () => {
        render(<RatingQuestion {...baseProps} question={ratingQuestion} initialValue={['invalid']} />)
        const buttons = screen.getAllByRole('button')
        const ratingButtons = buttons.filter((btn) => btn.textContent !== mockAppearance.submitButtonText)
        ratingButtons.forEach((button) => {
            expect(button).not.toHaveClass('rating-active')
        })
    })

    const ratingQuestion10Scale: RatingSurveyQuestion = {
        ...ratingQuestion,
        scale: 10,
        description: 'Scale from 0 to 10',
    }

    it('renders 10-scale correctly with initial value 0', () => {
        render(<RatingQuestion {...baseProps} question={ratingQuestion10Scale} initialValue={0} />)
        const button0 = getRatingButton(0)
        expect(button0).toHaveClass('rating-active')
    })

    it('renders 10-scale correctly with initial value 10', () => {
        render(<RatingQuestion {...baseProps} question={ratingQuestion10Scale} initialValue={'10'} />)
        const button10 = getRatingButton(10)
        expect(button10).toHaveClass('rating-active')
    })

    it('updates rating on click', () => {
        render(<RatingQuestion {...baseProps} question={ratingQuestion} initialValue={null} />)
        const button2 = getRatingButton(2)
        const button4 = getRatingButton(4)

        expect(button2).not.toHaveClass('rating-active')
        expect(button4).not.toHaveClass('rating-active')

        fireEvent.click(button4)
        expect(button2).not.toHaveClass('rating-active')
        expect(button4).toHaveClass('rating-active')

        fireEvent.click(button2)
        expect(button4).not.toHaveClass('rating-active')
        expect(button2).toHaveClass('rating-active')
    })

    it('calls onSubmit with the selected rating', () => {
        render(<RatingQuestion {...baseProps} question={ratingQuestion} initialValue={null} />)
        const button3 = getRatingButton(3)
        const submitButton = screen.getByText(mockAppearance.submitButtonText)

        fireEvent.click(button3)
        fireEvent.click(submitButton)

        expect(baseProps.onSubmit).toHaveBeenCalledWith(3)
    })

    it('submit button is disabled initially if question is not optional', () => {
        render(<RatingQuestion {...baseProps} question={ratingQuestion} initialValue={null} />)
        const submitButton = screen.getByText(mockAppearance.submitButtonText)
        expect(submitButton).toBeDisabled()
    })

    it('submit button is enabled initially if question is optional', () => {
        const optionalQuestion = { ...ratingQuestion, optional: true }
        render(<RatingQuestion {...baseProps} question={optionalQuestion} initialValue={null} />)
        const submitButton = screen.getByText(mockAppearance.submitButtonText)
        expect(submitButton).not.toBeDisabled()
    })

    it('submit button is enabled after selecting a rating', () => {
        render(<RatingQuestion {...baseProps} question={ratingQuestion} initialValue={null} />)
        const button3 = getRatingButton(3)
        const submitButton = screen.getByText(mockAppearance.submitButtonText)

        fireEvent.click(button3)
        expect(submitButton).not.toBeDisabled()
    })
})
