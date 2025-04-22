import { fireEvent, render } from '@testing-library/preact'
import { MultipleChoiceQuestion, OpenTextQuestion } from '../../../extensions/surveys/components/QuestionTypes'
import { BasicSurveyQuestion, MultipleSurveyQuestion, SurveyQuestionType } from '../../../posthog-surveys-types'

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
