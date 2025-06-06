import '@testing-library/jest-dom'

import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import {
    MultipleChoiceQuestion,
    OpenTextQuestion,
    RatingQuestion,
} from '../../../extensions/surveys/components/QuestionTypes'
import {
    BasicSurveyQuestion,
    MultipleSurveyQuestion,
    RatingSurveyQuestion,
    SurveyQuestionType,
} from '../../../posthog-surveys-types'

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

    describe('SingleChoice with skipSubmitButton', () => {
        const singleChoiceSkipQuestion: MultipleSurveyQuestion = {
            type: SurveyQuestionType.SingleChoice,
            question: 'What is your favorite color?',
            description: 'Choose one color',
            choices: ['Red', 'Blue', 'Green'],
            hasOpenChoice: false,
            optional: false,
            skipSubmitButton: true,
        }

        it('submits the selected choice immediately and hides button', () => {
            const onSubmitMock = jest.fn()
            const { getByLabelText, queryByText } = render(
                <MultipleChoiceQuestion {...baseProps} onSubmit={onSubmitMock} question={singleChoiceSkipQuestion} />
            )

            expect(queryByText('Submit')).not.toBeInTheDocument()
            // Click on 'Blue' option
            fireEvent.click(getByLabelText('Blue'))

            expect(onSubmitMock).toHaveBeenCalledWith('Blue')
        })

        it('shows submit button if skipSubmitButton is false', () => {
            const question = { ...singleChoiceSkipQuestion, skipSubmitButton: false }
            const { getByLabelText, queryByText } = render(
                <MultipleChoiceQuestion {...baseProps} question={question} />
            )
            expect(queryByText('Submit')).toBeInTheDocument()
            fireEvent.click(getByLabelText('Blue'))
            expect(baseProps.onSubmit).not.toHaveBeenCalled()
        })

        it('shows submit button if skipSubmitButton is true but hasOpenChoice is true', () => {
            const question = {
                ...singleChoiceSkipQuestion,
                hasOpenChoice: true,
                choices: [...singleChoiceSkipQuestion.choices, 'Other'],
            }
            const { getByLabelText, queryByText } = render(
                <MultipleChoiceQuestion {...baseProps} question={question} />
            )
            fireEvent.click(getByLabelText('Blue'))
            expect(baseProps.onSubmit).not.toHaveBeenCalled()
            expect(queryByText('Submit')).toBeInTheDocument()
        })

        it('shows submit button if skipSubmitButton but the type is multiple choice', () => {
            const question: MultipleSurveyQuestion = {
                ...singleChoiceSkipQuestion,
                type: SurveyQuestionType.MultipleChoice,
            }
            const { getByLabelText, queryByText } = render(
                <MultipleChoiceQuestion {...baseProps} question={question} />
            )
            expect(queryByText('Submit')).toBeInTheDocument()
            fireEvent.click(getByLabelText('Blue'))
            expect(baseProps.onSubmit).not.toHaveBeenCalled()
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

    describe('RatingQuestion with skipSubmitButton', () => {
        const ratingSkipQuestion: RatingSurveyQuestion = {
            type: SurveyQuestionType.Rating,
            question: 'How would you rate your experience?',
            description: 'Scale from 1 to 5',
            display: 'number',
            scale: 5,
            lowerBoundLabel: 'Bad',
            upperBoundLabel: 'Good',
            optional: false,
            skipSubmitButton: true,
        }

        const ratingEmojiSkipQuestion: RatingSurveyQuestion = {
            ...ratingSkipQuestion,
            display: 'emoji',
        }

        it('submits rating immediately and hides button for number display', async () => {
            const onSubmitMock = jest.fn()
            render(<RatingQuestion {...baseProps} onSubmit={onSubmitMock} question={ratingSkipQuestion} />)
            const button3 = getRatingButton(3)

            expect(screen.queryByText(mockAppearance.submitButtonText)).not.toBeInTheDocument()
            fireEvent.click(button3)

            await waitFor(() => {
                expect(onSubmitMock).toHaveBeenCalledWith(3)
            })
        })

        it('submits rating immediately and hides button for emoji display', async () => {
            const onSubmitMock = jest.fn()
            render(<RatingQuestion {...baseProps} onSubmit={onSubmitMock} question={ratingEmojiSkipQuestion} />)

            // Click the emoji button that corresponds to rating value 1
            const specificEmojiButton = screen.getByRole('button', { name: 'Rate 1' })

            expect(screen.queryByText(mockAppearance.submitButtonText)).not.toBeInTheDocument()
            fireEvent.click(specificEmojiButton)

            await waitFor(() => {
                expect(onSubmitMock).toHaveBeenCalledWith(1)
            })
        })

        it('shows submit button if skipSubmitButton is false for number display', () => {
            const question = { ...ratingSkipQuestion, skipSubmitButton: false }
            const onSubmitMock = jest.fn()
            render(<RatingQuestion {...baseProps} onSubmit={onSubmitMock} question={question} />)
            const button3 = getRatingButton(3)

            fireEvent.click(button3)

            expect(onSubmitMock).not.toHaveBeenCalled()
            expect(screen.queryByText(mockAppearance.submitButtonText)).toBeInTheDocument()
        })

        it('shows submit button if skipSubmitButton is false for emoji display', () => {
            const question = { ...ratingEmojiSkipQuestion, skipSubmitButton: false }
            const onSubmitMock = jest.fn()
            render(<RatingQuestion {...baseProps} onSubmit={onSubmitMock} question={question} />)

            // Click the emoji button that corresponds to rating value 1
            const specificEmojiButton = screen.getByRole('button', { name: 'Rate 1' })

            fireEvent.click(specificEmojiButton)

            expect(onSubmitMock).not.toHaveBeenCalled()
            expect(screen.queryByText(mockAppearance.submitButtonText)).toBeInTheDocument()
        })
    })
})
